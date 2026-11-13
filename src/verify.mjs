import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { build } from './build.mjs';

const require = createRequire(import.meta.url);

const DEFAULT_CONFIG = {
  build: {},
  sizeLimits: {
    html: { soft: 100 * 1024, hard: 150 * 1024 },
    css: { soft: 50 * 1024, hard: 80 * 1024 },
    js: { soft: 200 * 1024, hard: 300 * 1024 },
  },
  unit: {},
  e2e: { testDir: 'e2e', testMatch: '**/*.spec.{js,jsx,ts,tsx}' },
  regression: { maxDiffPixelRatio: 0.001, port: 0 },
};

const FILE_MAPPER = String.raw`\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$`;
const STYLE_MAPPER = String.raw`\.(css|less|scss|sass)$`;
const ALIAS_MAPPER = '^@/(.*)$';

export function parseVerifyArguments(argv) {
  const options = { cwd: process.cwd(), config: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--cwd' || arg === '--config') {
      const value = argv[index + 1];
      if (!value?.trim() || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
      options[arg === '--cwd' ? 'cwd' : 'config'] = value;
      index += 1;
    } else {
      throw new Error(`Unknown verify option: ${arg}`);
    }
  }
  return options;
}

export async function loadVerifyConfig(cwd, configPath) {
  const projectDir = path.resolve(cwd);
  const resolvedPath = configPath
    ? path.resolve(projectDir, configPath)
    : path.join(projectDir, '.cns-static-content.json');
  let content;
  try {
    content = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (!configPath && error.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    if (error.code === 'ENOENT') throw new Error(`Verify config not found: ${resolvedPath}`);
    throw error;
  }

  let projectConfig;
  try {
    projectConfig = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid verify config ${resolvedPath}: ${error.message}`);
  }
  if (!projectConfig || Array.isArray(projectConfig) || typeof projectConfig !== 'object') {
    throw new Error('Verify config must contain a JSON object.');
  }
  const config = {
    ...DEFAULT_CONFIG,
    ...projectConfig,
    build: { ...DEFAULT_CONFIG.build, ...projectConfig.build },
    sizeLimits: { ...DEFAULT_CONFIG.sizeLimits, ...projectConfig.sizeLimits },
    unit: { ...DEFAULT_CONFIG.unit, ...projectConfig.unit },
    e2e: { ...DEFAULT_CONFIG.e2e, ...projectConfig.e2e },
    regression: { ...DEFAULT_CONFIG.regression, ...projectConfig.regression },
  };
  validateSizeLimits(config.sizeLimits);
  validatePixelRatio(config.regression.maxDiffPixelRatio);
  return config;
}

function validateSizeLimits(sizeLimits) {
  for (const artifact of ['html', 'css', 'js']) {
    const limit = sizeLimits?.[artifact];
    if (!limit || !Number.isSafeInteger(limit.soft) || !Number.isSafeInteger(limit.hard) || limit.soft < 0 || limit.hard < limit.soft) {
      throw new Error(`sizeLimits.${artifact} must define non-negative integer soft and hard byte limits, with hard >= soft.`);
    }
  }
}

function validatePixelRatio(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error('regression.maxDiffPixelRatio must be a number from 0 to 1.');
  }
}

async function getBuiltResult(cwd, config, existingResult) {
  if (existingResult) return existingResult;
  return build({ cwd, ...config.build, clipboard: false });
}

export async function testSize({ cwd = process.cwd(), config, builtResult } = {}) {
  const verifyConfig = config ?? await loadVerifyConfig(cwd);
  validateSizeLimits(verifyConfig.sizeLimits);
  const result = await getBuiltResult(cwd, verifyConfig, builtResult);
  const measurements = {};
  const warnings = [];
  const failures = [];
  for (const artifact of ['html', 'css', 'js']) {
    const bytes = (await fs.stat(result.outputs[artifact])).size;
    const { soft, hard } = verifyConfig.sizeLimits[artifact];
    measurements[artifact] = { bytes, soft, hard };
    const label = `${artifact.toUpperCase()} ${formatBytes(bytes)} (soft ${formatBytes(soft)}, hard ${formatBytes(hard)})`;
    if (bytes > hard) failures.push(`${label}: exceeds hard size limit`);
    else if (bytes > soft) warnings.push(`${label}: exceeds soft size limit`);
  }
  return { measurements, warnings, failures };
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B`;
}

function resolveProjectEntry(projectDir, candidates, displayName) {
  const projectRequire = createRequire(path.join(projectDir, 'package.json'));
  for (const candidate of candidates) {
    try {
      return projectRequire.resolve(candidate);
    } catch {
      // Try the next supported package entry point.
    }
  }
  throw new Error(`${displayName} is required by this check but was not found from ${projectDir}. Install it in the project or a monorepo ancestor.`);
}

function runNodeScript(scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`${path.basename(scriptPath)} was terminated by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function withTemporaryConfig(contents, callback, suffix = '.json') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-verify-'));
  const configPath = path.join(directory, `config${suffix}`);
  try {
    await fs.writeFile(configPath, contents);
    return await callback(configPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function testUnit({ cwd = process.cwd(), config } = {}) {
  const projectDir = path.resolve(cwd);
  const verifyConfig = config ?? await loadVerifyConfig(projectDir);
  const jestPath = fileURLToPath(new URL('./jest-runner.mjs', import.meta.url));
  const jestConfig = createJestConfig(projectDir, verifyConfig.unit);
  return withTemporaryConfig(JSON.stringify(jestConfig, null, 2), (configPath) =>
    runNodeScript(jestPath, ['--config', configPath, '--runInBand'], projectDir));
}

export function createJestConfig(projectDir, overrides = {}) {
  const testEnvironment = overrides.testEnvironment;
  return {
    rootDir: projectDir,
    modulePaths: [projectDir],
    testRegex: '(/__tests__/).*Spec\\.jsx?$',
    moduleNameMapper: {
      [FILE_MAPPER]: '<rootDir>/__mocks__/fileMock.js',
      [STYLE_MAPPER]: require.resolve('identity-obj-proxy'),
      [ALIAS_MAPPER]: '<rootDir>/share/$1',
    },
    ...overrides,
    ...(testEnvironment === 'jsdom' || testEnvironment === 'jest-environment-jsdom'
      ? { testEnvironment: require.resolve('jest-environment-jsdom') }
      : {}),
  };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  })[extension] ?? 'application/octet-stream';
}

export async function startStaticServer(rootDirectory, { port = 0, indexFile = 'index.html' } = {}) {
  const root = path.resolve(rootDirectory);
  const server = http.createServer(async (request, response) => {
    try {
      const requestPath = request.url.startsWith('http://') || request.url.startsWith('https://')
        ? new URL(request.url).pathname
        : request.url.split('?')[0];
      const urlPath = decodeURIComponent(requestPath);
      const relativePath = urlPath === '/' ? indexFile : urlPath.replace(/^\/+/, '');
      const target = path.resolve(root, relativePath);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const data = await fs.readFile(target);
      response.writeHead(200, { 'content-type': contentType(target), 'content-length': data.length });
      response.end(data);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function withBuiltServer(cwd, verifyConfig, builtResult, callback, indexFile) {
  const result = await getBuiltResult(cwd, verifyConfig, builtResult);
  const server = await startStaticServer(path.dirname(result.outputs.html), {
    indexFile: indexFile ?? path.basename(result.outputs.html),
  });
  try {
    return await callback(server.url, result);
  } finally {
    await server.close();
  }
}

export async function testE2e({ cwd = process.cwd(), config, builtResult } = {}) {
  const projectDir = path.resolve(cwd);
  const verifyConfig = config ?? await loadVerifyConfig(projectDir);
  const playwrightPath = resolveProjectEntry(projectDir, ['playwright/cli.js', '@playwright/test/cli.js'], 'Playwright');
  return withBuiltServer(projectDir, verifyConfig, builtResult, async (url) => {
    const e2e = verifyConfig.e2e;
    const playwrightConfig = {
      testDir: path.resolve(projectDir, e2e.testDir),
      testMatch: e2e.testMatch,
      use: { baseURL: `${url}/`, ...e2e.use },
      ...e2e.playwright,
    };
    return withTemporaryConfig(`module.exports = ${JSON.stringify(playwrightConfig, null, 2)};\n`,
      (configPath) => runNodeScript(playwrightPath, ['test', '--config', configPath], projectDir), '.cjs');
  });
}

async function waitForServer(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Parcel dev server exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Parcel dev server at ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function startParcelServer(projectDir, entry, port) {
  const parcelPackage = require.resolve('parcel/package.json');
  const parcelManifest = JSON.parse(await fs.readFile(parcelPackage, 'utf8'));
  const bin = typeof parcelManifest.bin === 'string'
    ? parcelManifest.bin
    : parcelManifest.bin.parcel;
  const parcelPath = path.resolve(path.dirname(parcelPackage), bin);
  const child = spawn(process.execPath, [parcelPath, 'serve', `./${entry}`, '--port', String(port), '--host', '127.0.0.1', '--no-cache'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(url, child);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\n${logs.trim()}`);
  }
  return { url, stop: () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('close', resolve);
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    timeout.unref();
  }) };
}

async function findAvailablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function loadProjectPlaywright(projectDir) {
  const entry = resolveProjectEntry(projectDir, ['playwright', '@playwright/test'], 'Playwright');
  return import(pathToFileURL(entry).href);
}

async function takeScreenshot(browser, url, regressionConfig) {
  const page = await browser.newPage({ viewport: regressionConfig.viewport ?? { width: 1280, height: 720 } });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: regressionConfig.timeout ?? 30000 });
    if (regressionConfig.waitForSelector) await page.locator(regressionConfig.waitForSelector).waitFor();
    if (regressionConfig.waitMs) await page.waitForTimeout(regressionConfig.waitMs);
    return await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
  } finally {
    await page.close();
  }
}

export async function testRegression({ cwd = process.cwd(), config, builtResult } = {}) {
  const projectDir = path.resolve(cwd);
  const verifyConfig = config ?? await loadVerifyConfig(projectDir);
  validatePixelRatio(verifyConfig.regression.maxDiffPixelRatio);
  return withBuiltServer(projectDir, verifyConfig, builtResult, async (productionUrl, result) => {
    const devPort = verifyConfig.regression.port || await findAvailablePort();
    const devServer = await startParcelServer(projectDir, verifyConfig.build.entry ?? 'src/index.html', devPort);
    try {
      const { chromium } = await loadProjectPlaywright(projectDir);
      const browser = await chromium.launch({ headless: true });
      try {
        const [productionBuffer, developmentBuffer] = await Promise.all([
          takeScreenshot(browser, `${productionUrl}/`, verifyConfig.regression),
          takeScreenshot(browser, `${devServer.url}/`, verifyConfig.regression),
        ]);
        const production = PNG.sync.read(productionBuffer);
        const development = PNG.sync.read(developmentBuffer);
        if (production.width !== development.width || production.height !== development.height) {
          return {
            warnings: [`Regression screenshots have different dimensions (production ${production.width}x${production.height}, dev ${development.width}x${development.height}); manually review ${result.outputs.html}.`],
            diffRatio: 1,
          };
        }
        const diff = pixelmatch(production.data, development.data, null, production.width, production.height, {
          threshold: verifyConfig.regression.pixelThreshold ?? 0.1,
          includeAA: false,
        });
        const pixelCount = production.width * production.height;
        const diffRatio = diff / pixelCount;
        const warnings = diffRatio > verifyConfig.regression.maxDiffPixelRatio
          ? [`Production/dev visual difference: ${diff} of ${pixelCount} pixels (${(diffRatio * 100).toFixed(3)}%), over allowed ${(verifyConfig.regression.maxDiffPixelRatio * 100).toFixed(3)}%. Manually review the page.`]
          : [];
        return { diff, diffRatio, warnings };
      } finally {
        await browser.close();
      }
    } finally {
      await devServer.stop();
    }
  }, path.basename(verifyConfig.build.entry ?? 'src/index.html'));
}

export async function runVerify({ cwd = process.cwd(), config: configPath } = {}) {
  const projectDir = path.resolve(cwd);
  const config = await loadVerifyConfig(projectDir, configPath);
  const checks = [];
  let builtResult;
  const unitExit = await testUnit({ cwd: projectDir, config }).catch((error) => {
    checks.push({ name: 'test:unit', error: error.message });
    return null;
  });
  if (unitExit !== null) checks.push({ name: 'test:unit', exitCode: unitExit });

  try {
    builtResult = await getBuiltResult(projectDir, config);
    checks.push({ name: 'build', exitCode: 0 });
  } catch (error) {
    checks.push({ name: 'build', error: error.message });
  }
  if (builtResult) {
    const size = await testSize({ cwd: projectDir, config, builtResult }).catch((error) => ({ error: error.message }));
    checks.push({ name: 'test:size', ...size });
    const e2e = await testE2e({ cwd: projectDir, config, builtResult }).catch((error) => ({ error: error.message }));
    checks.push({ name: 'test:e2e', ...(typeof e2e === 'number' ? { exitCode: e2e } : e2e) });
    const regression = await testRegression({ cwd: projectDir, config, builtResult }).catch((error) => ({ error: error.message }));
    checks.push({ name: 'test:regression', ...regression });
  } else {
    for (const name of ['test:size', 'test:e2e', 'test:regression']) checks.push({ name, skipped: 'production build failed' });
  }
  return { checks, exitCode: checks.some((check) => check.error || check.exitCode > 0 || check.failures?.length) ? 1 : 0 };
}

export const verifyDefaults = DEFAULT_CONFIG;
