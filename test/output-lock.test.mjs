import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { acquireBuildOutput, acquireDevOutput } from '../src/output-lock.mjs';

const execute = promisify(execFile);

test('output locks stop only the dev server using the same output', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-output-lock-test-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'dist');
  const unrelated = path.join(cwd, 'other');
  let stopped = 0;
  const releaseOther = await acquireDevOutput(unrelated, () => { stopped += 100; });
  t.after(releaseOther);
  let resolveStop;
  const stoppedDev = new Promise((resolve) => { resolveStop = resolve; });
  const releaseDev = await acquireDevOutput(output, async () => {
    stopped += 1;
    await releaseDev();
    resolveStop();
  });
  const releaseBuild = await acquireBuildOutput(output);
  await stoppedDev;
  assert.equal(stopped, 1);
  await assert.rejects(acquireDevOutput(output, () => {}), /already in use by a build/);
  await assert.rejects(acquireBuildOutput(output), /already in use by a build/);
  await releaseBuild();
  const releaseAgain = await acquireDevOutput(output, () => {});
  await releaseAgain();
  assert.equal(stopped, 1);
});

test('output locks recover after an owner process exits unexpectedly', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-stale-lock-test-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/output-lock.mjs', import.meta.url).href;
  await execute(process.execPath, ['--input-type=module', '-e', `
    const { acquireDevOutput } = await import(${JSON.stringify(moduleUrl)});
    await acquireDevOutput(${JSON.stringify(path.join(cwd, 'dist'))}, () => {});
    process.exit(0);
  `]);
  const release = await acquireBuildOutput(path.join(cwd, 'dist'));
  await release();
});
