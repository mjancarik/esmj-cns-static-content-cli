import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import clipboardy from 'clipboardy';
import { JSDOM } from 'jsdom';
import { build } from '../src/build.mjs';

const execute = promisify(execFile);
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

async function project(t, name) {
  // Outside the checkout: no inherited aliases, .parcelrc, or workspace targets.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'static build example-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(fixtures, name), directory, { recursive: true });
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