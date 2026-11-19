import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import clipboardy from 'clipboardy';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright';
import purgecssPackage from 'purgecss';
import { build } from '../src/build.mjs';
import { generateResponsiveCss } from '../src/responsive-css.mjs';

const execute = promisify(execFile);
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const parcelServe = fileURLToPath(new URL('../src/parcel-serve.mjs', import.meta.url));
const repository = fileURLToPath(new URL('../', import.meta.url));
const purgecssBin = fileURLToPath(new URL('../node_modules/purgecss/bin/purgecss.js', import.meta.url));
const { PurgeCSS } = purgecssPackage;

async function project(t, name) {
  // Outside the checkout: no inherited aliases, .parcelrc, or workspace targets.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'static build example-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(fixtures, name), directory, {
    recursive: true,
    filter: (source) => !['dist', '.parcel-cache'].includes(path.basename(source)),
  });
  if (name === 'assets') {
    const encoded = await fs.readFile(path.join(directory, 'src/photo.jpg.base64'), 'utf8');
    await fs.writeFile(path.join(directory, 'src/photo.jpg'), Buffer.from(encoded, 'base64'));
  }
  return directory;
}

async function artifacts(result) {
  const html = await fs.readFile(result.outputs.html, 'utf8');
  const css = await fs.readFile(result.outputs.css, 'utf8');
  const js = await fs.readFile(result.outputs.js, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  assert.equal(dom.window.document.querySelector('style').textContent.trim(), css.trim());
  assert.equal(dom.window.document.querySelector('script:not([type])').textContent.trim(), js.trim());
  return { html, css, js, dom };
}

function stubClipboard(t, implementation) {
  const original = clipboardy.writeSync;
  clipboardy.writeSync = implementation;
  t.after(() => { clipboardy.writeSync = original; });
}

test('build bundles HTML, CSS imports, JS modules, JSON, SVG and JPEG outside the repo', async (t) => {
  const cwd = await project(t, 'assets');
  const outDir = path.join(cwd, 'artifacts');
  await fs.mkdir(outDir);
  await fs.writeFile(path.join(outDir, 'stale.txt'), 'remove on rebuild');
  stubClipboard(t, () => assert.fail('Clipboard must be disabled'));

  const result = await build({
    cwd,
    outDir: 'artifacts',
    clipboard: false,
    purgeContent: ['extra/content.html'],
    purgeIgnore: ['keep.css'],
  });
  assert.deepEqual(result.outputs, {
    html: path.join(outDir, 'staticContent.html'),
    css: path.join(outDir, 'staticContent.css'),
    js: path.join(outDir, 'staticContent.js'),
  });
  assert.equal(result.clipboardWritten, false);
  assert.equal(result.clipboardWarning, null);
  await assert.rejects(fs.access(path.join(outDir, 'stale.txt')));

  const { css, js, dom } = await artifacts(result);
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelector('#development-only'), null);
  assert.equal(document.querySelector('h1').textContent, 'Example content');
  assert.equal(document.querySelector('#inline-icon path').getAttribute('fill'), 'green');
  assert.match(css, /text-decoration:\s*underline/);
  assert.match(css, /\.from-javascript/);
  assert.match(css, /\.keep-from-content/);
  assert.match(css, /\.keep-from-ignore/);
  assert.doesNotMatch(css, /unused-selector/);
  assert.doesNotMatch(js, /sourceMappingURL/);

  const photo = document.querySelector('#photo').getAttribute('src');
  const icon = document.querySelector('#icon').getAttribute('src');
  assert.match(photo, /^data:image\/jpeg;base64,/);
  assert.match(icon, /^data:image\/svg\+xml;base64,/);
  const photoBytes = Buffer.from(photo.slice('data:image/jpeg;base64,'.length), 'base64');
  const iconBytes = Buffer.from(icon.slice('data:image/svg+xml;base64,'.length), 'base64');
  assert.deepEqual(photoBytes, await fs.readFile(path.join(cwd, 'src/photo.jpg')));
  assert.match(iconBytes.toString('utf8'), /<svg/);
  assert.match(css, /url\(data:image\/jpeg;base64,/);

  dom.window.eval(js);
  assert.equal(dom.window.fixtureRuns, 1, 'Do not concatenate module and nomodule alternatives');
  assert.equal(document.querySelector('#message').textContent, 'Bundled JSON: SVG, JPEG, CSS');
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.fixtureData)), {
    title: 'Bundled JSON', items: ['SVG', 'JPEG', 'CSS'], enabled: true,
  });
});

test('mock package export is included in development and removed in production', async (t) => {
  const cwd = await project(t, 'assets');
  await fs.mkdir(path.join(cwd, 'node_modules/@esmj'), { recursive: true });
  await fs.symlink(repository, path.join(cwd, 'node_modules/@esmj/cns-static-content-cli'), 'junction');
  await fs.appendFile(path.join(cwd, 'src/index.js'), "\nimport '@esmj/cns-static-content-cli/mock';\n");
  const packagePath = path.join(cwd, 'package.json');
  const originalPackage = await fs.readFile(packagePath, 'utf8');

  await execute(process.execPath, [cli, '--cwd', cwd, '--no-clipboard'], {
    cwd: os.tmpdir(),
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 120000,
  });
  const result = {
    outputs: {
      html: path.join(cwd, 'dist/staticContent.html'),
      css: path.join(cwd, 'dist/staticContent.css'),
      js: path.join(cwd, 'dist/staticContent.js'),
    },
  };
  const js = await fs.readFile(result.outputs.js, 'utf8');
  assert.doesNotMatch(js, /\[Mock\]/);
  const { dom } = await artifacts(result);
  t.after(() => dom.window.close());
  dom.window.eval(js);
  assert.equal(dom.window.$resizeStaticContent, undefined);
  assert.equal(await fs.readFile(packagePath, 'utf8'), originalPackage);

  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: available } = server.address();
      server.close((error) => error ? reject(error) : resolve(available));
    });
  });
  const server = spawn(process.execPath, [parcelServe, './src/index.html', 'dist', String(port), '127.0.0.1', '/', 'false'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (chunk) => { logs += chunk; });
  server.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    await new Promise((resolve) => {
      server.once('close', resolve);
      server.kill('SIGTERM');
    });
  });
  const url = `http://127.0.0.1:${port}/`;
  let response;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Parcel server exited: ${logs}`);
    try {
      response = await fetch(url);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(response?.ok, `Parcel server did not start: ${logs}`);
  const page = new JSDOM(await response.text(), { url, runScripts: 'outside-only' });
  t.after(() => page.window.close());
  const scriptUrl = new URL(page.window.document.querySelector('script[type="module"]').getAttribute('src'), url);
  const script = await fetch(scriptUrl);
  assert.equal(script.status, 200);
  page.window.eval(await script.text());
  assert.equal(typeof page.window.$resizeStaticContent, 'function');
  assert.equal(typeof page.window.DOT.hit, 'function');
  assert.equal(await fs.readFile(packagePath, 'utf8'), originalPackage);
});

for (const scenario of ['default', 'project override', 'custom parcelrc']) {
  test(`package exports respect ${scenario}`, async (t) => {
    const cwd = await project(t, 'assets');
    const packagePath = path.join(cwd, 'package.json');
    const manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    if (scenario === 'project override') manifest['@parcel/resolver-default'] = { packageExports: false };
    const originalPackage = JSON.stringify(manifest);
    await fs.writeFile(packagePath, originalPackage);
    const dependency = path.join(cwd, 'node_modules/export-example');
    await fs.mkdir(dependency, { recursive: true });
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({
      name: 'export-example', main: './legacy.js', exports: './export.js',
    }));
    await fs.writeFile(path.join(dependency, 'legacy.js'), 'export default "legacy";\n');
    await fs.writeFile(path.join(dependency, 'export.js'), 'export default "exports";\n');
    await fs.appendFile(path.join(cwd, 'src/index.js'), '\nimport marker from "export-example"; window.exportMarker = marker;\n');
    if (scenario === 'custom parcelrc') {
      await fs.mkdir(path.join(cwd, 'node_modules/@parcel'), { recursive: true });
      await fs.symlink(path.join(repository, 'node_modules/@parcel/config-default'), path.join(cwd, 'node_modules/@parcel/config-default'), 'junction');
      await fs.writeFile(path.join(cwd, '.parcelrc'), JSON.stringify({ extends: '@parcel/config-default' }));
    }
    const result = await build({ cwd, clipboard: false });
    const { dom, js } = await artifacts(result);
    t.after(() => dom.window.close());
    dom.window.eval(js);
    assert.equal(dom.window.exportMarker, scenario === 'default' ? 'exports' : 'legacy');
    assert.equal(await fs.readFile(packagePath, 'utf8'), originalPackage);
  });
}

for (const override of [false, true]) {
  test(`project-root aliases use ${override ? 'project overrides' : 'CLI defaults'}`, async (t) => {
    const cwd = await project(t, 'assets');
    const manifestPath = path.join(cwd, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (override) manifest.alias = { '@/*': './other/$1', '@merkur/*': './other/merkur.js' };
    const original = JSON.stringify(manifest);
    await fs.writeFile(manifestPath, original);
    await fs.mkdir(path.join(cwd, 'share'), { recursive: true });
    await fs.mkdir(path.join(cwd, 'other'), { recursive: true });
    await fs.mkdir(path.join(cwd, 'node_modules/@merkur/core/lib'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'share/value.js'), 'export default "share";\n');
    await fs.writeFile(path.join(cwd, 'other/value.js'), 'export default "override";\n');
    await fs.writeFile(path.join(cwd, 'other/merkur.js'), 'export default "custom";\n');
    await fs.writeFile(path.join(cwd, 'node_modules/@merkur/core/package.json'), JSON.stringify({ name: '@merkur/core' }));
    await fs.writeFile(path.join(cwd, 'node_modules/@merkur/core/lib/index.es9.mjs'), 'export default "merkur";\n');
    await fs.appendFile(path.join(cwd, 'src/index.js'),
      '\nimport value from "@/value.js"; import merkur from "@merkur/core"; window.aliasResults = [value, merkur];\n');
    const result = await build({ cwd, clipboard: false });
    const { dom, js } = await artifacts(result);
    t.after(() => dom.window.close());
    dom.window.eval(js);
    assert.deepEqual(Array.from(dom.window.aliasResults), override ? ['override', 'custom'] : ['share', 'merkur']);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), original);
  });
}

test('workspace aliases use the monorepo root and respect package-level overrides', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-alias-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'packages/example');
  await fs.mkdir(path.dirname(cwd), { recursive: true });
  await fs.cp(path.join(fixtures, 'assets'), cwd, { recursive: true });
  const encoded = await fs.readFile(path.join(cwd, 'src/photo.jpg.base64'), 'utf8');
  await fs.writeFile(path.join(cwd, 'src/photo.jpg'), Buffer.from(encoded, 'base64'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'workspace-root', private: true }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'workspace-root', lockfileVersion: 3 }));
  await fs.mkdir(path.join(root, 'share'), { recursive: true });
  await fs.writeFile(path.join(root, 'share/value.js'), 'export default "root";\n');
  await fs.mkdir(path.join(root, 'node_modules/@merkur/core/lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/@merkur/core/package.json'), JSON.stringify({ name: '@merkur/core' }));
  await fs.writeFile(path.join(root, 'node_modules/@merkur/core/lib/index.es9.mjs'), 'export default "root-merkur";\n');
  await fs.mkdir(path.join(cwd, 'custom'));
  await fs.writeFile(path.join(cwd, 'custom/merkur.js'), 'export default "package-override";\n');
  const packagePath = path.join(cwd, 'package.json');
  const manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  manifest.alias = { '@merkur/*': './custom/merkur.js' };
  const original = JSON.stringify(manifest);
  await fs.writeFile(packagePath, original);
  await fs.appendFile(path.join(cwd, 'src/index.js'),
    '\nimport value from "@/value.js"; import merkur from "@merkur/core"; window.aliasResults = [value, merkur];\n');
  const result = await build({ cwd, clipboard: false });
  const { dom, js } = await artifacts(result);
  t.after(() => dom.window.close());
  dom.window.eval(js);
  assert.deepEqual(Array.from(dom.window.aliasResults), ['root', 'package-override']);
  assert.equal(await fs.readFile(packagePath, 'utf8'), original);
});

for (const override of [false, true]) {
  test(`CSS custom media uses ${override ? 'project override' : 'CLI default'}`, async (t) => {
    const cwd = await project(t, 'assets');
    const manifestPath = path.join(cwd, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (override) manifest['@parcel/transformer-css'] = { drafts: { customMedia: false } };
    const original = JSON.stringify(manifest);
    await fs.writeFile(manifestPath, original);
    await fs.appendFile(path.join(cwd, 'src/index.css'),
      '\n@custom-media --narrow (max-width: 600px);\n@media (--narrow) { .headline { color: red; } }\n.headline { & span { color: blue; } }\n');
    const result = await build({ cwd, clipboard: false, purge: false });
    const css = await fs.readFile(result.outputs.css, 'utf8');
    if (override) assert.match(css, /--narrow/);
    else {
      assert.doesNotMatch(css, /--narrow/);
      assert.match(css, /max-width:\s*600px/);
    }
    assert.match(css, /headline\s+span/);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), original);
  });
}

test('responsive CSS profiling uses CLI Playwright outside the CLI project', async (t) => {
  const cwd = await project(t, 'assets');
  const projectPlaywright = path.join(cwd, 'node_modules/playwright');
  await fs.mkdir(projectPlaywright, { recursive: true });
  await fs.writeFile(path.join(projectPlaywright, 'index.js'), 'throw new Error("project Playwright must not run");\n');
  const originalLaunch = chromium.launch;
  t.after(() => { chromium.launch = originalLaunch; });
  let width;
  let pageDom;
  const launchOptions = [];
  const visited = [];
  chromium.launch = async (options) => {
    launchOptions.push(options);
    return {
      newPage: async () => ({
        goto: async (url) => {
          visited.push(url);
          const response = await fetch(url);
          assert.equal(response.status, 200);
          pageDom = new JSDOM(await response.text());
        },
        evaluate: async () => {},
        locator: (selector) => ({
          count: async () => pageDom.window.document.querySelectorAll(selector).length,
          evaluate: async () => ({ width, heightRem: width > 320 ? 10 : 20, ampIframeVisible: false }),
        }),
        setViewportSize: async (viewport) => { width = viewport.width; },
      }),
      close: async () => { pageDom?.window.close(); },
    };
  };
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    page: '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle',
  }));
  const result = await build({
    cwd,
    clipboard: false,
    purgeIgnore: ['keep.css'],
    responsiveCss: { minWidth: 320, maxWidth: 324, step: 4 },
  });
  assert.equal(result.outputs.responsiveCss, path.join(cwd, 'dist/__CLASS__.css'));
  assert.equal(new URL(visited[0]).pathname + new URL(visited[0]).search, '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle');
  assert.equal(
    await fs.readFile(result.outputs.responsiveCss, 'utf8'),
    '__CLASS__ {\n  height: 10rem;\n}\n\n@media only screen and (max-width: 320px) {\n  __CLASS__ {\n    height: 20rem;\n  }\n}\n',
  );
  const fragment = await fs.readFile(result.outputs.html, 'utf8');
  assert.doesNotMatch(fragment, /<main\b/i);
  assert.match(fragment, /Example content/);
  await generateResponsiveCss({
    htmlPath: result.outputs.html,
    outputPath: result.outputs.responsiveCss,
    options: { selector: '#message', minWidth: 320, maxWidth: 324, step: 4, debug: true },
  });
  await assert.rejects(generateResponsiveCss({
    htmlPath: result.outputs.html,
    outputPath: result.outputs.responsiveCss,
    options: { selector: '#missing', minWidth: 320, maxWidth: 324, step: 4 },
  }), /Responsive CSS target not found: #missing/);
  assert.deepEqual(launchOptions, [
    { headless: true },
    { headless: false, slowMo: 100 },
    { headless: true },
  ]);
});

test('responsive CSS measures generated content using the configured page query', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    t.skip('Playwright Chromium is not installed');
    return;
  }
  await browser.close();
  const cwd = await project(t, 'assets');
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    page: '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle',
  }));
  await fs.appendFile(path.join(cwd, 'src/index.js'), `
    const parentUrl = new URLSearchParams(location.search).get('parentUrl');
    document.querySelector('#message').style.height =
      parentUrl === 'https://www.sport.cz/article' ? '320px' : '80px';
  `);
  const result = await build({
    cwd,
    clipboard: false,
    responsiveCss: { selector: '#message', minWidth: 320, maxWidth: 324, step: 4 },
  });
  assert.match(await fs.readFile(result.outputs.responsiveCss, 'utf8'), /height: 20rem/);
});

test('responsive CSS reports the matching browser installation command', async (t) => {
  const cwd = await project(t, 'assets');
  const originalLaunch = chromium.launch;
  t.after(() => { chromium.launch = originalLaunch; });
  const missingBrowser = new Error("Executable doesn't exist");
  chromium.launch = async () => { throw missingBrowser; };
  await assert.rejects(generateResponsiveCss({
    htmlPath: path.join(cwd, 'src/index.html'),
    outputPath: path.join(cwd, 'out.css'),
  }), (error) => {
    assert.equal(error.cause, missingBrowser);
    assert.match(error.message, /npx --yes playwright@[\d.]+ install chromium/);
    return true;
  });
});

test('regression CLI prints the directory containing browser images', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    t.skip('Playwright Chromium is not installed');
    return;
  }
  await browser.close();
  const cwd = await project(t, 'assets');
  const live = http.createServer((_request, response) => response.end('<html><body>Live content</body></html>'));
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => live.close(resolve)));
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    regression: { productionUrl: `http://127.0.0.1:${live.address().port}/live` },
  }));
  await fs.mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await fs.symlink(path.join(repository, 'node_modules/playwright'), path.join(cwd, 'node_modules/playwright'), 'junction');
  const { stdout, stderr } = await execute(process.execPath, [cli, 'test:regression', '--cwd', cwd], { timeout: 120000 });
  const match = stdout.match(/^Regression screenshots: (.+)$/m);
  assert.ok(match, stdout);
  assert.equal(path.dirname(match[1]), path.join(cwd, 'test-results'));
  assert.match(stderr, /Warning:.*(visual difference|different dimensions)/);
  await assert.rejects(fs.access(path.join(cwd, 'dist/staticContent.html')), { code: 'ENOENT' });
  for (const name of ['production.png', 'development.png']) {
    assert.ok((await fs.stat(path.join(match[1], name))).size > 0);
  }
});

test('dev proxy serves a browser request and preserves Parcel HMR', async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!error.message.includes("Executable doesn't exist")) throw error;
    t.skip('Playwright Chromium is not installed');
    return;
  }
  t.after(() => browser.close());
  const cwd = await project(t, 'assets');
  const api = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ url: request.url }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const apiPort = api.address().port;
  await fs.writeFile(path.join(cwd, '.cns-static-content.json'), JSON.stringify({
    page: '/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle',
    dev: { proxy: { '/__proxy/api': `http://127.0.0.1:${apiPort}/base` } },
  }));
  await fs.appendFile(path.join(cwd, 'src/index.js'), `
    const apiBase = process.env.NODE_ENV === 'production' ? 'https://live.example' : '/__proxy/api';
    fetch(apiBase + '/items?filter=hello%20world').then((r) => r.json()).then((value) => {
      document.querySelector('#message').textContent = value.url;
    });
  `);
  const result = await build({ cwd, clipboard: false });
  const productionJs = await fs.readFile(result.outputs.js, 'utf8');
  for (const artifact of ['html', 'css', 'js']) {
    const contents = await fs.readFile(result.outputs[artifact], 'utf8');
    assert.doesNotMatch(contents, new RegExp(`127\\.0\\.0\\.1:${apiPort}`));
    assert.doesNotMatch(contents, /__proxy\/api/);
  }
  assert.match(productionJs, /live\.example/);

  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const openedPath = path.join(cwd, 'opened-url.txt');
  const readyPath = path.join(cwd, 'allow-preview.txt');
  const preloadPath = path.join(cwd, 'open-stub.mjs');
  await fs.writeFile(preloadPath, `
    import { createRequire } from 'node:module';
    import { access, writeFile } from 'node:fs/promises';
    const require = createRequire(${JSON.stringify(parcelServe)});
    const Parcel = require('@parcel/core').Parcel;
    const watch = Parcel.prototype.watch;
    Parcel.prototype.watch = function(callback) {
      const subscription = watch.call(this, callback);
      callback(null, { type: 'buildSuccess' });
      return subscription;
    };
    const fetchPreview = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      try {
        await access(${JSON.stringify(readyPath)});
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return new Response('Starting', { status: 503 });
      }
      return fetchPreview(url, options);
    };
    const utils = require('@parcel/utils');
    Object.defineProperty(utils, 'openInBrowser', {
      value: async (url) => {
        try {
          const response = await fetch(url);
          await writeFile(${JSON.stringify(openedPath)}, JSON.stringify({ url, status: response.status, body: await response.text() }));
        } catch (error) {
          await writeFile(${JSON.stringify(openedPath)}, JSON.stringify({ url, error: error.message }));
        }
      },
    });
  `);
  const child = spawn(process.execPath, ['--import', preloadPath, parcelServe, './src/index.html', 'dist', String(port), '127.0.0.1', '/', 'true'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      child.once('close', resolve);
      child.kill('SIGTERM');
    });
  });
  const url = `http://127.0.0.1:${port}/`;
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${logs}`);
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Dev server did not start: ${logs}`);
  assert.match(logs, /Dev proxy enabled: \/__proxy\/api/);
  for (let attempt = 0; attempt < 300 && !/Built in/.test(logs); attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(logs, /Built in/);
  await assert.rejects(fs.access(openedPath), { code: 'ENOENT' });
  await fs.writeFile(readyPath, 'ready');
  let opened;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      opened = JSON.parse(await fs.readFile(openedPath, 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(opened?.url, `http://127.0.0.1:${port}/preview?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle`, logs);
  assert.equal(opened?.status, 200, JSON.stringify(opened));
  assert.match(opened.body, /Example content/);
  const page = await browser.newPage();
  const socketOpened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Parcel HMR websocket did not open')), 10000);
    page.on('websocket', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await page.goto(opened.url);
  await page.waitForFunction(() => document.querySelector('#message')?.textContent === '/base/items?filter=hello%20world');
  await socketOpened;
  await page.close();
});

test('dev preview waits for a successful build before opening and opens only once', async (t) => {
  const cwd = await project(t, 'assets');
  const scriptPath = path.join(cwd, 'src/index.js');
  const original = await fs.readFile(scriptPath, 'utf8');
  await fs.appendFile(scriptPath, "\nimport './missing-preview-test.js';\n");
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const openedPath = path.join(cwd, 'opened.txt');
  const preloadPath = path.join(cwd, 'open-stub.mjs');
  await fs.writeFile(preloadPath, `
    import { createRequire } from 'node:module';
    import { appendFile } from 'node:fs/promises';
    const require = createRequire(${JSON.stringify(parcelServe)});
    Object.defineProperty(require('@parcel/utils'), 'openInBrowser', {
      value: async (url) => {
        const response = await fetch(url);
        await appendFile(${JSON.stringify(openedPath)}, response.status + '\\n');
      },
    });
  `);
  const child = spawn(process.execPath, ['--import', preloadPath, parcelServe, './src/index.html', 'dist', String(port), '127.0.0.1', '/', 'true'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      child.once('close', resolve);
      child.kill('SIGTERM');
    });
  });
  for (let attempt = 0; attempt < 300 && !/missing-preview-test\.js/.test(logs); attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(logs, /missing-preview-test\.js/);
  await assert.rejects(fs.access(openedPath), { code: 'ENOENT' });
  await fs.writeFile(scriptPath, original);
  let opened;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${logs}`);
    try {
      opened = await fs.readFile(openedPath, 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(opened, '200\n', logs);
  const completedBuilds = (logs.match(/Built in/g) ?? []).length;
  await fs.appendFile(scriptPath, '\n');
  for (let attempt = 0; attempt < 300 && (logs.match(/Built in/g) ?? []).length <= completedBuilds; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok((logs.match(/Built in/g) ?? []).length > completedBuilds, logs);
  assert.equal(await fs.readFile(openedPath, 'utf8'), '200\n');
});

test('PurgeCSS API safelists have the same exact-selector behavior as its CLI', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'purgecss safelist-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const cssPath = path.join(cwd, 'input.css');
  const contentPath = path.join(cwd, 'content.html');
  await fs.writeFile(cssPath, '.leaflet- { color: red; }\n.leaflet-container { color: blue; }');
  await fs.writeFile(contentPath, '<main></main>');

  const { stdout } = await execute(process.execPath, [
    purgecssBin, '--css', cssPath, '--content', contentPath, '--safelist', 'leaflet-',
  ]);
  const legacyCss = JSON.parse(stdout)[0].css;
  const apiResult = await new PurgeCSS().purge({
    css: [cssPath],
    content: [contentPath],
    safelist: ['leaflet-'],
  });

  assert.equal(apiResult[0].css, legacyCss);
  assert.match(legacyCss, /\.leaflet-/);
  assert.doesNotMatch(legacyCss, /\.leaflet-container/);
});

test('build applies exact PurgeCSS safelist selectors', async (t) => {
  const cwd = await project(t, 'assets');
  await fs.appendFile(path.join(cwd, 'src/index.css'), '\n.leaflet- { color: red; }\n.leaflet-container { color: blue; }\n');
  const result = await build({ cwd, clipboard: false, purgeIgnore: ['keep.css'], purgeSafelist: ['leaflet-'] });
  const css = await fs.readFile(result.outputs.css, 'utf8');

  assert.match(css, /\.leaflet-/);
  assert.doesNotMatch(css, /\.leaflet-container/);
});

test('production optimization can be disabled and relative public URLs remain exportable', async (t) => {
  const optimizedProject = await project(t, 'assets');
  const sourceJs = path.join(optimizedProject, 'src/index.js');
  await fs.appendFile(sourceJs, `\n${'window.optimizationCheck = "kept"; '.repeat(30)}\n`);
  const optimized = await build({ cwd: optimizedProject, clipboard: false, purgeIgnore: ['keep.css'] });
  const optimizedJs = await fs.readFile(optimized.outputs.js, 'utf8');

  const unoptimizedProject = await project(t, 'assets');
  const unoptimizedSourceJs = path.join(unoptimizedProject, 'src/index.js');
  await fs.appendFile(unoptimizedSourceJs, `\n${'window.optimizationCheck = "kept"; '.repeat(30)}\n`);
  const unoptimized = await build({ cwd: unoptimizedProject, clipboard: false, purgeIgnore: ['keep.css'], optimize: false });
  const unoptimizedJs = await fs.readFile(unoptimized.outputs.js, 'utf8');
  assert.ok(unoptimizedJs.length > optimizedJs.length, 'Production optimization should reduce output size');

  const relativeUrlProject = await project(t, 'assets');
  const relativeUrl = await build({ cwd: relativeUrlProject, clipboard: false, purgeIgnore: ['keep.css'], publicUrl: './' });
  const bundledHtml = await fs.readFile(path.join(relativeUrlProject, 'dist/index.html'), 'utf8');
  assert.match(bundledHtml, /src=photo\.[^\s>]+\.jpg/);
  const { html, css, dom } = await artifacts(relativeUrl);
  t.after(() => dom.window.close());
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.match(css, /url\(data:image\/jpeg;base64,/);
});

test('mixed inline and linked assets are all exported and execute exactly once', async (t) => {
  const cwd = await project(t, 'assets');
  const entry = path.join(cwd, 'src/index.html');
  const source = await fs.readFile(entry, 'utf8');
  await fs.writeFile(entry, source
    .replace('</head>', '<style>.headline { border: 1px solid red; }</style></head>')
    .replace('</body>', '<script>window.mixedRuns = (window.mixedRuns || 0) + 1;</script></body>'));
  const result = await build({ cwd, clipboard: false });
  const { css, js, dom } = await artifacts(result);
  t.after(() => dom.window.close());
  assert.match(css, /border:/);
  assert.match(css, /text-decoration:/);
  dom.window.eval(js);
  assert.equal(dom.window.fixtureRuns, 1);
  assert.equal(dom.window.mixedRuns, 1);
});

test('inline body fallback preserves JSON data and copies exactly the exported HTML', async (t) => {
  const cwd = await project(t, 'inline');
  let copied;
  stubClipboard(t, (value) => { copied = value; });
  const result = await build({ cwd });
  const { html, js, dom } = await artifacts(result);
  t.after(() => dom.window.close());
  assert.equal(result.clipboardWritten, true);
  assert.equal(copied, html);
  assert.match(html, /Legacy body content/);
  const configuration = dom.window.document.querySelector('#configuration');
  assert.ok(configuration, 'Non-executable JSON scripts must remain in the markup');
  assert.deepEqual(JSON.parse(configuration.textContent), { message: 'not executable JavaScript' });
  dom.window.eval(js);
  assert.equal(dom.window.inlineRuns, 1);
});

test('exported static HTML inlines local media assets so it remains portable', async (t) => {
  const cwd = await project(t, 'assets');
  const htmlPath = path.join(cwd, 'src/index.html');
  const originalHtml = await fs.readFile(htmlPath, 'utf8');
  await fs.writeFile(
    htmlPath,
    originalHtml.replace(
      '<img id="icon" src="./icon.svg" alt="Example SVG">',
      '<img id="icon" src="https://cdn.example.com/icon.svg" alt="Example SVG">',
    ),
  );
  const result = await build({ cwd, clipboard: false });
  const html = await fs.readFile(result.outputs.html, 'utf8');
  const css = await fs.readFile(result.outputs.css, 'utf8');

  assert.doesNotMatch(html, /(?:src|href)=["'](?:\.|\/)[^"']+\.(?:jpg|jpeg|png|svg|gif|webp|avif)["']/i);
  assert.doesNotMatch(css, /url\((?:["']?)(?:\.|\/)[^"')]+\.(?:jpg|jpeg|png|svg|gif|webp|avif)(?:["']?)\)/i);
  assert.match(html, /data:image\/jpeg;base64,/i);
  assert.match(html, /https:\/\/cdn\.example\.com\/icon\.svg/i);
  assert.match(css, /data:image\/jpeg;base64,/i);
  assert.doesNotMatch(css, /https:\/\/cdn\.example\.com\/icon\.svg/i);
});

test('clipboard failure warns but leaves usable artifacts', async (t) => {
  const cwd = await project(t, 'inline');
  stubClipboard(t, () => { throw new Error('headless test environment'); });
  const result = await build({ cwd });
  assert.equal(result.clipboardWritten, false);
  assert.match(result.clipboardWarning, /Clipboard unavailable: headless test environment/);
  const { dom } = await artifacts(result);
  dom.window.close();
});

test('CLI builds a custom entry/output from a different working directory', async (t) => {
  const cwd = await project(t, 'assets');
  await fs.rename(path.join(cwd, 'src/index.html'), path.join(cwd, 'src/landing.html'));
  const { stdout, stderr } = await execute(process.execPath, [
    cli, '--cwd', cwd, '--entry', 'src/landing.html', '--out-dir', 'output', '--no-clipboard',
  ], { cwd: os.tmpdir(), timeout: 120000 });
  assert.equal(stderr, '');
  assert.match(stdout, /Created .*staticContent\.html/);
  for (const extension of ['html', 'css', 'js']) {
    assert.ok((await fs.stat(path.join(cwd, 'output', `staticContent.${extension}`))).size > 0);
  }
});

test('build uses a project-relative POSIX JS path for ES-Check with custom output directories', async (t) => {
  const cwd = await project(t, 'inline');
  const outDir = 'custom-output';
  const result = await build({ cwd, outDir, clipboard: false });

  assert.equal(path.relative(cwd, result.outputs.js).split(path.sep).join('/'), `${outDir}/staticContent.js`);
  assert.ok((await fs.stat(result.outputs.js)).size > 0);
});

for (const conflictingConfig of [false, true]) {
  test(`CLI owns browser targets outside the checkout (${conflictingConfig ? 'conflicting' : 'no'} project browser config)`, async (t) => {
    const cwd = await project(t, 'assets');
    const packagePath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    if (conflictingConfig) {
      packageJson.browserslist = ['last 1 Chrome version'];
      packageJson.targets = {
        default: {
          engines: { browsers: ['last 1 Chrome version'] },
          distDir: 'wrong-output',
        },
      };
      await fs.writeFile(path.join(cwd, '.browserslistrc'), 'last 1 Chrome version\n');
    } else {
      delete packageJson.targets;
    }
    const originalPackage = JSON.stringify(packageJson);
    await fs.writeFile(packagePath, originalPackage);
    await fs.appendFile(path.join(cwd, 'src/index.js'), '\nwindow.browserTargetValue = window.input?.value ?? "fallback";\n');
    await fs.appendFile(path.join(cwd, 'src/index.css'), '\nh1 { user-select: none; }\n');

    await execute(process.execPath, [cli, '--cwd', cwd, '--no-clipboard'], {
      cwd: os.tmpdir(),
      env: { ...process.env, BROWSERSLIST: 'last 1 Chrome version' },
      timeout: 120000,
    });
    const js = await fs.readFile(path.join(cwd, 'dist/staticContent.js'), 'utf8');
    const css = await fs.readFile(path.join(cwd, 'dist/staticContent.css'), 'utf8');
    assert.doesNotMatch(js, /\?\.|\?\?/, 'Modern syntax must be lowered for the CLI browser targets');
    assert.match(css, /-webkit-user-select/, 'CSS must be prefixed for Safari 11.1');
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.document.body.innerHTML = '<p id="message"></p>';
    dom.window.eval(js);
    assert.equal(dom.window.browserTargetValue, 'fallback');
    assert.equal(await fs.readFile(packagePath, 'utf8'), originalPackage);
    await assert.rejects(fs.access(path.join(cwd, 'wrong-output')));
  });
}

test('CLI help and argument failures have the expected exit status', async () => {
  const { stdout } = await execute(process.execPath, [cli, '--help']);
  assert.match(stdout, /Usage: esmj-cns-static-content-cli/);
  await assert.rejects(execute(process.execPath, [cli, '--unknown']), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Unknown option/);
    return true;
  });
});

test('missing entry fails without deleting an existing output directory', async (t) => {
  const cwd = await project(t, 'inline');
  await fs.mkdir(path.join(cwd, 'dist'));
  await fs.writeFile(path.join(cwd, 'dist/keep.txt'), 'keep');
  await assert.rejects(build({ cwd, entry: 'missing.html', clipboard: false }), /Entry file not found/);
  assert.equal(await fs.readFile(path.join(cwd, 'dist/keep.txt'), 'utf8'), 'keep');
});

test('unresolved imports fail the build and never write to the clipboard', async (t) => {
  const cwd = await project(t, 'assets');
  await fs.writeFile(path.join(cwd, 'src/index.js'), "import './missing-file.js';");
  stubClipboard(t, () => assert.fail('Invalid builds must not be copied'));
  await assert.rejects(build({ cwd }), /missing-file|resolve/i);
  await assert.rejects(fs.access(path.join(cwd, 'dist/staticContent.html')));
});

test('JavaScript that cannot be lowered to ES2018 fails before clipboard export', async (t) => {
  const cwd = await project(t, 'inline');
  const entry = path.join(cwd, 'src/index.html');
  const html = await fs.readFile(entry, 'utf8');
  await fs.writeFile(entry, html.replace('window.inlineRuns = (window.inlineRuns || 0) + 1;',
    'window.value = 1n;'));
  stubClipboard(t, () => assert.fail('Invalid JavaScript must not be copied'));
  await assert.rejects(build({ cwd }), /ES-Check|ES version|es-check|Unexpected token/i);
});