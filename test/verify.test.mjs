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
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

import {
  createJestConfig,
  loadVerifyConfig,
  parseVerifyArguments,
  startStaticServer,
  testE2e,
  testRegression,
  testSize,
  verifyDefaults,
} from '../src/verify.mjs';
import {
  formatResponsiveCss,
  normalizeResponsiveOptions,
  summarizeResponsiveMeasurements,
} from '../src/responsive-css.mjs';
import { loadProjectPage, normalizeProjectPage } from '../src/project-page.mjs';

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

test('project page defaults to root and rejects external or malformed URLs', async (t) => {
  const cwd = await temporaryProject(t);
  assert.equal(await loadProjectPage(cwd), '/');
  const page = '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle#details';
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({ page }));
  assert.equal(await loadProjectPage(cwd), page);
  assert.equal((await loadVerifyConfig(cwd)).page, page);
  for (const invalid of ['https://example.com/', '//example.com/', '/\\example.com', '/bad\npath', null, 123]) {
    assert.throws(() => normalizeProjectPage(invalid), /page must be/);
  }
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

test('regression skips without a production URL and rejects invalid configured URLs', async (t) => {
  const cwd = await temporaryProject(t);
  assert.deepEqual(await testRegression({ cwd }), { skipped: 'production URL not configured', warnings: [] });
  const { stdout } = await execute(process.execPath, [cli, 'test:regression', '--cwd', cwd]);
  assert.match(stdout, /SKIPPED.*production URL not configured/);
  await assert.rejects(fs.access(path.join(cwd, 'test-results')), { code: 'ENOENT' });
  for (const productionUrl of ['', null, '/local', 'file:///tmp/test', 'https://user:pass@example.com/']) {
    await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({ regression: { productionUrl } }));
    await assert.rejects(loadVerifyConfig(cwd), /regression\.productionUrl/);
  }
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
  const server = await startStaticServer(root, { indexFile: 'staticContent.html', page: '/preview?parentUrl=test' });
  t.after(() => server.close());
  const page = await fetch(`${server.url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Built project/);
  assert.match(await (await fetch(`${server.url}/preview?parentUrl=test`)).text(), /Built project/);
  const { port } = new URL(server.url);
  const traversalStatus = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: Number(port), path: '/%2e%2e%2foutside.txt' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(traversalStatus, 403);
});

test('E2E resolves the project Playwright executable from its public package manifest', async (t) => {
  const cwd = await temporaryProject(t);
  const packageDir = path.join(cwd, 'node_modules/playwright');
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name: 'playwright', exports: { './package.json': './package.json' }, bin: { playwright: './cli.js' },
  }));
  await fs.writeFile(path.join(packageDir, 'cli.js'), `
    const config = require(process.argv[4]);
    require("node:fs").writeFileSync("playwright-args.json", JSON.stringify({ args: process.argv.slice(2), use: config.use }));
  `);
  const output = path.join(cwd, 'dist/staticContent.html');
  await fs.mkdir(path.dirname(output));
  await fs.writeFile(output, '<main>test</main>');
  const exitCode = await testE2e({
    cwd,
    config: { page: '/preview?parentUrl=hello%20world', e2e: {
      testDir: 'e2e', testMatch: '**/*.spec.js', use: { locale: 'cs-CZ', trace: 'off' },
      playwright: { use: { trace: 'on' } },
    } },
    builtResult: { outputs: { html: output } },
  });
  assert.equal(exitCode, 0);
  const { args, use } = JSON.parse(await fs.readFile(path.join(cwd, 'playwright-args.json'), 'utf8'));
  assert.equal(args[0], 'test');
  assert.equal(args[1], '--config');
  assert.match(use.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/preview\?parentUrl=hello%20world$/);
  assert.equal(use.locale, 'cs-CZ');
  assert.equal(use.trace, 'on');
  assert.equal(await testE2e({
    cwd,
    config: { page: '/', e2e: { testDir: 'e2e', testMatch: '**/*.spec.js',
      playwright: { use: { baseURL: 'https://override.example/', trace: 'on' } } } },
    builtResult: { outputs: { html: output } },
  }), 0);
  const override = JSON.parse(await fs.readFile(path.join(cwd, 'playwright-args.json'), 'utf8'));
  assert.equal(override.use.baseURL, 'https://override.example/');
  assert.equal(override.use.trace, 'on');
});

test('E2E can navigate to the configured default page', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    t.skip('Playwright Chromium is not installed');
    return;
  }
  await browser.close();
  const cwd = await temporaryProject(t);
  await fs.mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await fs.symlink(fileURLToPath(new URL('../node_modules/playwright', import.meta.url)), path.join(cwd, 'node_modules/playwright'), 'junction');
  await fs.mkdir(path.join(cwd, 'e2e'));
  await fs.writeFile(path.join(cwd, 'e2e/page.spec.js'), `
    const { test, expect } = require('playwright/test');
    test('default page', async ({ page, baseURL }) => {
      await page.goto(baseURL);
      await expect(page.locator('h1')).toHaveText('https://www.sport.cz/article');
      await expect(page).toHaveURL(/#details$/);
    });
  `);
  await fs.mkdir(path.join(cwd, 'dist'));
  const output = path.join(cwd, 'dist/staticContent.html');
  await fs.writeFile(output, '<h1></h1><script>document.querySelector("h1").textContent = new URLSearchParams(location.search).get("parentUrl");</script>');
  assert.equal(await testE2e({
    cwd,
    config: { page: '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle#details',
      e2e: { testDir: 'e2e', testMatch: '**/*.spec.js', playwright: { use: { trace: 'on' } } } },
    builtResult: { outputs: { html: output } },
  }), 0);
});

test('regression supports a project CommonJS Playwright default export', async (t) => {
  const cwd = await temporaryProject(t);
  const live = http.createServer((_request, response) => response.end('<main>live</main>'));
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => live.close(resolve)));
  const productionUrl = `http://127.0.0.1:${live.address().port}/live?fixture=1#content`;
  const packageDir = path.join(cwd, 'node_modules/playwright');
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name: 'playwright', main: './index.cjs', exports: { '.': './index.cjs' },
  }));
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([0, 0, 0, 255]);
  const imagePath = path.join(cwd, 'image.png');
  const developmentPath = path.join(cwd, 'development.png');
  await fs.writeFile(imagePath, PNG.sync.write(png));
  await fs.writeFile(developmentPath, PNG.sync.write(png));
  await fs.writeFile(path.join(packageDir, 'index.cjs'), `
    const makeApi = () => ({ chromium: { launch: async () => ({
      newPage: async () => {
        const screenshotPath = ++pageCount % 2 ? ${JSON.stringify(imagePath)} : ${JSON.stringify(developmentPath)};
        return {
        goto: async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Page not available: " + url);
          require("node:fs").appendFileSync(${JSON.stringify(path.join(cwd, 'visited.txt'))}, url + "\\n");
          return { ok: () => response.ok, status: () => response.status };
        },
        screenshot: async () => require("node:fs").readFileSync(screenshotPath),
        close: async () => {},
      }; },
      close: async () => {},
    }) } });
    let pageCount = 0;
    module.exports = makeApi();
  `);
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src/index.html'), '<html><body><main>test</main></body></html>');
  await fs.mkdir(path.join(cwd, 'dist'));
  const output = path.join(cwd, 'dist/staticContent.html');
  await fs.writeFile(output, '<main>test</main>');
  await fs.writeFile(path.join(cwd, 'dist/index.html'), '<html><body><main>test</main></body></html>');
  const result = await testRegression({
    cwd,
    config: { page: '/preview?parentUrl=hello%20world', build: { entry: 'src/index.html' }, regression: { productionUrl, maxDiffPixelRatio: 0.001 } },
  });
  assert.equal(result.diffRatio, 0);
  assert.deepEqual(await fs.readFile(result.artifacts.production), await fs.readFile(imagePath));
  assert.deepEqual(await fs.readFile(result.artifacts.development), await fs.readFile(developmentPath));
  assert.equal(PNG.sync.read(await fs.readFile(result.artifacts.diff)).width, 1);
  const visited = (await fs.readFile(path.join(cwd, 'visited.txt'), 'utf8')).trim().split('\n');
  assert.equal(visited.length, 2);
  assert.equal(visited[0], productionUrl);
  assert.equal(new URL(visited[1]).pathname + new URL(visited[1]).search, '/preview?parentUrl=hello%20world');

  const different = new PNG({ width: 1, height: 1 });
  different.data.set([255, 255, 255, 255]);
  await fs.writeFile(developmentPath, PNG.sync.write(different));
  const config = { build: { entry: 'src/index.html' }, regression: { productionUrl, maxDiffPixelRatio: 0.001 } };
  const changed = await testRegression({ cwd, config });
  assert.equal(changed.diffRatio, 1);
  assert.equal(changed.warnings.length, 1);
  assert.notEqual(changed.artifacts.directory, result.artifacts.directory);
  assert.equal(PNG.sync.read(await fs.readFile(changed.artifacts.diff)).width, 1);

  const larger = new PNG({ width: 2, height: 1 });
  await fs.writeFile(developmentPath, PNG.sync.write(larger));
  const mismatched = await testRegression({ cwd, config });
  assert.match(mismatched.warnings[0], /different dimensions/);
  assert.equal(PNG.sync.read(await fs.readFile(mismatched.artifacts.production)).width, 1);
  assert.equal(PNG.sync.read(await fs.readFile(mismatched.artifacts.development)).width, 2);
  assert.equal(mismatched.artifacts.diff, undefined);
  assert.match(mismatched.artifacts.directory, /test-results[\\/]visual-regression-/);

  const baseline = new PNG({ width: 10, height: 10 });
  for (let index = 3; index < baseline.data.length; index += 4) baseline.data[index] = 255;
  await fs.writeFile(imagePath, PNG.sync.write(baseline));
  baseline.data.set([255, 255, 255, 255], (5 * 10 + 5) * 4);
  await fs.writeFile(developmentPath, PNG.sync.write(baseline));
  const atLimit = await testRegression({
    cwd, config: { ...config, regression: { productionUrl, maxDiffPixelRatio: 0.01 } },
  });
  assert.equal(atLimit.diff, 1);
  assert.equal(atLimit.diffRatio, 0.01);
  assert.equal(atLimit.warnings.length, 0);
  const overLimit = await testRegression({
    cwd, config: { ...config, regression: { productionUrl, maxDiffPixelRatio: 0.009 } },
  });
  assert.equal(overLimit.diffRatio, 0.01);
  assert.equal(overLimit.warnings.length, 1);
});

test('regression saves real browser screenshots and a visible diff', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    t.skip('Playwright Chromium is not installed');
    return;
  }
  await browser.close();
  const cwd = await temporaryProject(t);
  const live = http.createServer((request, response) => {
    if (request.url === '/missing') return response.writeHead(404).end('not found');
    return response.end('<html><body style="background: blue"></body></html>');
  });
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => live.close(resolve)));
  const liveUrl = `http://127.0.0.1:${live.address().port}`;
  await fs.mkdir(path.join(cwd, 'node_modules'));
  await fs.symlink(fileURLToPath(new URL('../node_modules/playwright', import.meta.url)), path.join(cwd, 'node_modules/playwright'), 'junction');
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src/index.html'), '<html><body style="background: red"></body></html>');
  await fs.mkdir(path.join(cwd, 'dist'));
  const productionPage = '<html><body style="background: blue"></body></html>';
  await fs.writeFile(path.join(cwd, 'dist/index.html'), productionPage);
  const output = path.join(cwd, 'dist/staticContent.html');
  await fs.writeFile(output, '<main>test</main>');
  await fs.mkdir(path.join(cwd, 'test-results'));
  await fs.writeFile(path.join(cwd, 'test-results/keep.txt'), 'existing results');
  const result = await testRegression({
    cwd,
    config: { build: { entry: 'src/index.html' }, regression: {
      productionUrl: `${liveUrl}/live`, maxDiffPixelRatio: 0.001, viewport: { width: 100, height: 100 },
    } },
  });
  assert.ok(result.diff > 0);
  assert.equal(result.warnings.length, 1);
  for (const artifact of ['production', 'development', 'diff']) {
    const image = PNG.sync.read(await fs.readFile(result.artifacts[artifact]));
    assert.equal(image.width, 100);
    assert.equal(image.height, 100);
  }
  assert.equal(await fs.readFile(path.join(cwd, 'test-results/keep.txt'), 'utf8'), 'existing results');
  assert.equal(await fs.readFile(path.join(cwd, 'dist/index.html'), 'utf8'), productionPage);
  await assert.rejects(testRegression({
    cwd,
    config: { build: { entry: 'src/index.html' }, regression: { productionUrl: `${liveUrl}/missing`, maxDiffPixelRatio: 0.001 } },
  }), /HTTP 404/);
  await assert.rejects(testRegression({
    cwd,
    config: { build: { entry: 'src/index.html' }, regression: {
      productionUrl: 'http://127.0.0.1:1/unreachable', maxDiffPixelRatio: 0.001, timeout: 5000,
    } },
  }), /ERR_UNSAFE_PORT|ERR_CONNECTION|net::/);
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
    assert.match(error.stdout, /test:regression: SKIPPED \(production URL not configured\)/);
    return true;
  });
});