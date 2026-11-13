import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createJestConfig,
  loadVerifyConfig,
  parseVerifyArguments,
  startStaticServer,
  testSize,
  verifyDefaults,
} from '../src/verify.mjs';
import {
  formatResponsiveCss,
  normalizeResponsiveOptions,
  summarizeResponsiveMeasurements,
} from '../src/responsive-css.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const require = createRequire(import.meta.url);

async function temporaryProject(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-verify-test-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return cwd;
}

test('verify arguments support project/config selection and help', () => {
  assert.deepEqual(parseVerifyArguments([]), {
    cwd: process.cwd(), config: undefined, help: false,
  });
  assert.deepEqual(parseVerifyArguments(['--cwd', '/repo', '--config', 'check.json']), {
    cwd: '/repo', config: 'check.json', help: false,
  });
  assert.equal(parseVerifyArguments(['--help']).help, true);
  assert.throws(() => parseVerifyArguments(['--cwd']), /Missing value/);
  assert.throws(() => parseVerifyArguments(['--config', '']), /Missing value/);
  assert.throws(() => parseVerifyArguments(['--write']), /Unknown verify option/);
});

test('default size limits use raw bytes and project config can centrally override them', async (t) => {
  const cwd = await temporaryProject(t);
  const defaults = await loadVerifyConfig(cwd);
  assert.deepEqual(defaults.sizeLimits, {
    html: { soft: 102400, hard: 153600 },
    css: { soft: 51200, hard: 81920 },
    js: { soft: 204800, hard: 307200 },
  });
  assert.equal(defaults.e2e.testDir, 'e2e');
  assert.equal(defaults.regression.maxDiffPixelRatio, 0.001);
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    sizeLimits: { html: { soft: 10, hard: 20 } },
    regression: { maxDiffPixelRatio: 0.02 },
  }));
  const config = await loadVerifyConfig(cwd);
  assert.deepEqual(config.sizeLimits.html, { soft: 10, hard: 20 });
  assert.deepEqual(config.sizeLimits.css, defaults.sizeLimits.css);
  assert.equal(config.regression.maxDiffPixelRatio, 0.02);
  await assert.rejects(loadVerifyConfig(cwd, 'absent.json'), /config not found/i);
  await fs.writeFile(path.join(cwd, 'broken.json'), '{');
  await assert.rejects(loadVerifyConfig(cwd, 'broken.json'), /Invalid verify config/);
});

test('size verification warns over soft limit and fails over hard limit', async (t) => {
  const cwd = await temporaryProject(t);
  const output = path.join(cwd, 'dist');
  await fs.mkdir(output);
  const outputs = {};
  for (const [artifact, size] of Object.entries({ html: 11, css: 21, js: 4 })) {
    outputs[artifact] = path.join(output, `staticContent.${artifact}`);
    await fs.writeFile(outputs[artifact], Buffer.alloc(size));
  }
  const config = {
    sizeLimits: {
      html: { soft: 10, hard: 20 },
      css: { soft: 10, hard: 20 },
      js: { soft: 10, hard: 20 },
    },
  };
  const result = await testSize({ cwd, config, builtResult: { outputs } });
  assert.deepEqual(result.warnings, ['HTML 11 B (soft 10 B, hard 20 B): exceeds soft size limit']);
  assert.deepEqual(result.failures, ['CSS 21 B (soft 10 B, hard 20 B): exceeds hard size limit']);
  assert.equal(result.measurements.js.bytes, 4);
});

test('size config rejects invalid thresholds', async (t) => {
  const cwd = await temporaryProject(t);
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    sizeLimits: { html: { soft: 20, hard: 10 } },
  }));
  await assert.rejects(loadVerifyConfig(cwd), /sizeLimits\.html/);
});

test('CLI-owned Jest defaults preserve the requested mappings and allow overrides', () => {
  const config = createJestConfig('/repo', { testEnvironment: 'jsdom' });
  assert.equal(config.rootDir, '/repo');
  assert.deepEqual(config.modulePaths, ['/repo']);
  assert.equal(config.testRegex, '(/__tests__/).*Spec\\.jsx?$');
  assert.equal(config.moduleNameMapper[String.raw`\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$`], '<rootDir>/__mocks__/fileMock.js');
  assert.equal(config.moduleNameMapper[String.raw`\.(css|less|scss|sass)$`], require.resolve('identity-obj-proxy'));
  assert.equal(config.moduleNameMapper['^@/(.*)$'], '<rootDir>/share/$1');
  assert.equal(config.testEnvironment, require.resolve('jest-environment-jsdom'));
});

test('unit tests use CLI-owned Jest, jsdom and CSS mock outside the CLI project', async (t) => {
  const cwd = await temporaryProject(t);
  const testsDirectory = path.join(cwd, 'src/__tests__');
  const projectJest = path.join(cwd, 'node_modules/jest');
  await fs.mkdir(testsDirectory, { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'test-project' }));
  const testFile = path.join(testsDirectory, 'exampleSpec.js');
  await fs.writeFile(testFile, 'test("node environment", () => expect(1 + 1).toBe(2));\n');
  await execute(process.execPath, [cli, 'test:unit', '--cwd', cwd]);

  await fs.mkdir(projectJest, { recursive: true });
  await fs.writeFile(path.join(projectJest, 'package.json'), JSON.stringify({
    name: 'jest', exports: { './bin/jest': './jest.js', './bin/jest.js': './jest.js' },
  }));
  await fs.writeFile(path.join(projectJest, 'jest.js'), 'throw new Error("project Jest must not run");\n');
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    unit: { testEnvironment: 'jsdom' },
  }));
  await fs.writeFile(path.join(cwd, 'src/styles.css'), '.title { color: red; }\n');
  await fs.writeFile(testFile, [
    'const styles = require("../styles.css");',
    'test("browser environment and CSS mock", () => {',
    '  expect(document.createElement("div").tagName).toBe("DIV");',
    '  expect(styles.title).toBe("title");',
    '});',
    '',
  ].join('\n'));
  await execute(process.execPath, [cli, 'test:unit', '--cwd', cwd]);
});

test('temporary static server serves build output and blocks directory traversal', async (t) => {
  const cwd = await temporaryProject(t);
  const root = path.join(cwd, 'public');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'staticContent.html'), '<h1>Built project</h1>');
  await fs.writeFile(path.join(cwd, 'outside.txt'), 'private');
  const server = await startStaticServer(root, { indexFile: 'staticContent.html' });
  t.after(() => server.close());
  const page = await fetch(`${server.url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Built project/);
  const { port } = new URL(server.url);
  const traversalStatus = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: Number(port), path: '/%2e%2e%2foutside.txt' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(traversalStatus, 403);
});

test('verify defaults are exposed for central policy inspection', () => {
  assert.equal(verifyDefaults.sizeLimits.html.soft, 100 * 1024);
  assert.equal(verifyDefaults.sizeLimits.html.hard, 150 * 1024);
});

test('responsive measurements collapse unchanged widths and emit application placeholder CSS', () => {
  const measurements = [
    { width: 1600, heightRem: 68.24 },
    { width: 1596, heightRem: 68.26 },
    { width: 1044, heightRem: 42 },
    { width: 800, heightRem: 69.5, ampIframeVisible: true },
    { width: 320, heightRem: 69.49, ampIframeVisible: true },
  ];
  assert.deepEqual(summarizeResponsiveMeasurements(measurements), [
    { width: 1600, heightRem: 68.25, ampIframeVisible: false, maxWidth: null },
    { width: 1044, heightRem: 42, ampIframeVisible: false, maxWidth: 1044 },
    { width: 800, heightRem: 69.5, ampIframeVisible: true, maxWidth: 800 },
  ]);
  assert.equal(formatResponsiveCss(measurements), [
    '__CLASS__ {',
    '  height: 68.25rem;',
    '}',
    '',
    '@media only screen and (max-width: 1044px) {',
    '  __CLASS__ {',
    '    height: 42rem;',
    '  }',
    '}',
    '',
    '@media only screen and (max-width: 800px) {',
    '  __CLASS__, __CLASS__ amp-iframe {',
    '    height: 69.5rem;',
    '  }',
    '}',
    '',
  ].join('\n'));
});

test('responsive CSS settings are validated and support a custom viewport range', () => {
  assert.deepEqual(normalizeResponsiveOptions(false).enabled, false);
  assert.deepEqual(normalizeResponsiveOptions({ minWidth: 360, maxWidth: 1440, step: 8 }).minWidth, 360);
  assert.throws(() => normalizeResponsiveOptions({ minWidth: 1600 }), /minWidth must be less/);
  assert.throws(() => normalizeResponsiveOptions({ step: 1281 }), /step must be smaller/);
  assert.throws(() => normalizeResponsiveOptions({ selector: '' }), /selector must be/);
  assert.throws(() => normalizeResponsiveOptions({ roundToRem: 0 }), /roundToRem/);
  assert.throws(() => normalizeResponsiveOptions({ debug: 'true' }), /responsiveCss\.debug/);
});

test('verify CLI continues to size stage and prints a final summary after unit failure', async (t) => {
  const cwd = await temporaryProject(t);
  const testsDirectory = path.join(cwd, 'src/__tests__');
  await fs.mkdir(testsDirectory, { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'test-project' }));
  await fs.writeFile(path.join(testsDirectory, 'failureSpec.js'), 'test("fails", () => { expect(false).toBe(true); });\n');
  await fs.writeFile(path.join(cwd, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="./src/index.css"></head><body><main>ready</main><script type="module" src="./src/index.js"></script></body></html>');
  await fs.writeFile(path.join(cwd, 'src/index.js'), "import './index.css'; window.verifyReady = true;\n");
  await fs.writeFile(path.join(cwd, 'src/index.css'), 'main { color: green; }\n');
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    build: { entry: 'index.html', purge: false },
  }));
  await assert.rejects(execute(process.execPath, [cli, 'verify', '--cwd', cwd], { timeout: 120000 }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Expected: true/);
    assert.match(error.stdout, /test:unit: FAILED/);
    assert.match(error.stdout, /build: passed/);
    assert.match(error.stdout, /test:size:/);
    assert.match(error.stdout, /test:e2e: FAILED/);
    return true;
  });
});