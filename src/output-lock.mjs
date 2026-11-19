import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const WAIT_MS = 15000;

async function canonicalOutput(outDir) {
  let current = path.resolve(outDir);
  const suffix = [];
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function lockPath(outDir) {
  const output = await canonicalOutput(outDir);
  const hash = createHash('sha256').update(output).digest('hex');
  const user = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `cns-static-output-${user}-${hash}`);
}

async function readOwner(directory) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0) {
    throw new Error(`Unsafe output lock directory: ${directory}`);
  }
  const owner = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8'));
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
    !['dev', 'build'].includes(owner.kind) || typeof owner.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(owner.token) ||
    (owner.kind === 'dev' && (!Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535))) {
    throw new Error(`Invalid output lock: ${directory}`);
  }
  return owner;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function removeStaleLock(directory, owner) {
  const claimPath = path.join(directory, 'recovery');
  let claim;
  try {
    claim = await fs.open(claimPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'ENOENT') return;
    throw error;
  }
  try {
    const current = await readOwner(directory);
    if (current.token !== owner.token || isAlive(current.pid)) return;
    await fs.unlink(path.join(directory, 'owner.json'));
  } finally {
    await claim.close();
    await fs.unlink(claimPath);
  }
  await fs.rmdir(directory);
}

async function requestStop(owner) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: owner.port,
      method: 'POST',
      path: '/stop',
      headers: { authorization: `Bearer ${owner.token}` },
      signal: AbortSignal.timeout(1000),
    }, (response) => {
      response.resume();
      if (response.statusCode === 202) resolve();
      else reject(new Error('Dev server rejected the shutdown request.'));
    });
    request.once('error', reject);
    request.end();
  });
}

async function claimLock(directory, owner, stopDev) {
  const deadline = Date.now() + WAIT_MS;
  let requestedToken;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        await fs.rm(path.join(directory, 'owner.json'), { force: true });
        await fs.rmdir(directory);
        throw error;
      }
      return async () => {
        const current = await readOwner(directory);
        if (current.token !== owner.token) throw new Error(`Output lock ownership changed: ${directory}`);
        await fs.unlink(path.join(directory, 'owner.json'));
        await fs.rmdir(directory);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    let current;
    try {
      current = await readOwner(directory);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        await delay(50);
        continue;
      }
      throw error;
    }
    if (!isAlive(current.pid)) {
      await removeStaleLock(directory, current);
      continue;
    }
    if (!stopDev || current.kind !== 'dev') {
      throw new Error(`Output directory is already in use by a ${current.kind} process.`);
    }
    if (requestedToken !== current.token) {
      try {
        await requestStop(current);
        requestedToken = current.token;
        console.log('Stopping the dev server before building.');
      } catch (error) {
        if (isAlive(current.pid)) throw new Error(`Unable to stop the dev server: ${error.message}`);
      }
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the output directory lock: ${directory}`);
}

export async function acquireBuildOutput(outDir) {
  const owner = { kind: 'build', pid: process.pid, token: randomBytes(32).toString('hex') };
  return claimLock(await lockPath(outDir), owner, true);
}

export async function acquireDevOutput(outDir, stop) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/stop' || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(202).end();
    setImmediate(stop);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let release;
  try {
    release = await claimLock(await lockPath(outDir), {
      kind: 'dev', pid: process.pid, token, port: server.address().port,
    }, false);
  } catch (error) {
    await new Promise((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
    throw error;
  }
  return async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await release();
  };
}
