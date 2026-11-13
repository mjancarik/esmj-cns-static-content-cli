import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { lint, parseLintArguments } from '../src/lint.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const repository = fileURLToPath(new URL('../', import.meta.url));
const baseline = fileURLToPath(new URL('../src/biome-preset.json', import.meta.url));

async function project(t, source = 'console.warn("warning"); console.error("error");\n') {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'static lint example-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src/index.js'), source);
  return cwd;
}

test('lint arguments default to src and support paths, config, cwd and safe fixes', () => {
  assert.deepEqual(parseLintArguments([]), {
    cwd: process.cwd(), paths: ['src'], write: false, help: false,
  });
  assert.deepEqual(parseLintArguments([
    '--cwd', '/project', '--config', '../../biome.jsonc', '--write', 'src/index.js', 'tests',
  ]), {
    cwd: '/project', config: '../../biome.jsonc', write: true, help: false,
    paths: ['src/index.js', 'tests'],
  });
  assert.equal(parseLintArguments(['-h']).help, true);
  assert.deepEqual(parseLintArguments(['--unsafe', '--write']), {
    cwd: process.cwd(), paths: ['src'], write: true, unsafe: true, help: false,
  });
  assert.deepEqual(parseLintArguments(['--', '-file.js']).paths, ['-file.js']);
  for (const option of ['--cwd', '--config']) {
    assert.throws(() => parseLintArguments([option]), /Missing value/);
    assert.throws(() => parseLintArguments([option, '--write']), /Missing value/);
    assert.throws(() => parseLintArguments([option, ' ']), /Missing value/);
  }
  assert.throws(() => parseLintArguments(['--dev']), /Unknown lint option/);
});

test('standalone lint allows log/warn/error and browser, Jest and Jasmine globals without formatting', async (t) => {
  const source = 'console.log("info"); console.warn("warning"); console.error("error");\n' +
    'describe("suite", () => { it("works", () => { expect(window.document).toBeDefined(); }); });\n' +
    'beforeEach(() => { jest.clearAllMocks(); jasmine.clock(); });\n' +
    'globalThis.result = navigator.userAgent;\n';
  const cwd = await project(t, source);
  const result = await lint({ cwd });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /schema version does not match|DEPRECATED/);
  assert.equal(await fs.readFile(path.join(cwd, 'src/index.js'), 'utf8'), source);
  await assert.rejects(fs.access(path.join(cwd, 'biome.json')));
  await assert.rejects(fs.access(path.join(cwd, 'dist')));
});

test('baseline rejects other console calls and undeclared variables and respects selected files', async (t) => {
  const cwd = await project(t, 'console.debug("debug"); missingGlobal();\n');
  const result = await lint({ cwd });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr + result.stdout, /noConsole/);
  assert.match(result.stderr + result.stdout, /noUndeclaredVariables/);
  await fs.writeFile(path.join(cwd, 'src/good.mjs'), 'console.warn("allowed");\n');
  const selected = await lint({ cwd, paths: ['src/good.mjs'] });
  assert.equal(selected.exitCode, 0, selected.stderr);
});

test('safe fixes are opt-in and do not reformat source', async (t) => {
  const cwd = await project(t, 'let count = 1;\nconsole.warn(count);\n');
  const file = path.join(cwd, 'src/index.js');
  const original = await fs.readFile(file, 'utf8');
  await lint({ cwd });
  assert.equal(await fs.readFile(file, 'utf8'), original);
  const result = await lint({ cwd, write: true });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(await fs.readFile(file, 'utf8'), /const count/);
});

test('unsafe fixes require explicit opt-in via the API and CLI', async (t) => {
  const cwd = await project(t, 'console.debug("debug");\nconsole.warn("kept");\n');
  const file = path.join(cwd, 'src/index.js');
  const safe = await lint({ cwd, write: true });
  assert.notEqual(safe.exitCode, 0);
  assert.match(await fs.readFile(file, 'utf8'), /console\.debug/);
  await assert.rejects(lint({ cwd, unsafe: true }), /requires --write/);
  await assert.rejects(lint({ cwd, unsafe: 'yes' }), /boolean/);
  await assert.rejects(execute(process.execPath, [cli, 'lint', '--cwd', cwd, '--unsafe']), /requires --write/);
  await execute(process.execPath, [cli, 'lint', '--cwd', cwd, '--write', '--unsafe']);
  const fixed = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(fixed, /console\.debug/);
  assert.match(fixed, /console\.warn/);
  await fs.writeFile(file, 'console.debug("debug");\n');
  const apiResult = await lint({ cwd, write: true, unsafe: true });
  assert.equal(apiResult.exitCode, 0, apiResult.stdout + apiResult.stderr);
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /console\.debug/);
});

test('monorepo JSONC config extends the exported package baseline and overrides rules', async (t) => {
  const root = await project(t);
  await fs.mkdir(path.join(root, 'node_modules/@esmj'), { recursive: true });
  await fs.symlink(repository, path.join(root, 'node_modules/@esmj/cns-static-content-cli'), 'junction');
  const config = '{\n// Monorepo-specific policy\n"extends": ["@esmj/cns-static-content-cli/biome.json"],\n' +
    '"linter": { "rules": { "suspicious": { "noConsole": "off" } } }\n}\n';
  await fs.writeFile(path.join(root, 'biome.jsonc'), config);
  const cwd = path.join(root, 'packages/example');
  await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'src/index.js'), 'console.debug("monorepo allowed");\n');
  const result = await lint({ cwd });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /schema version does not match|DEPRECATED/);
  assert.equal(await fs.readFile(path.join(root, 'biome.jsonc'), 'utf8'), config);
  // Inherited baseline rules are still enabled even though noConsole was overridden.
  await fs.appendFile(path.join(cwd, 'src/index.js'), 'missingGlobal();\n');
  const invalid = await lint({ cwd });
  assert.match(invalid.stdout + invalid.stderr, /noUndeclaredVariables/);
});

test('explicit config wins and missing or invalid configs fail without fallback', async (t) => {
  const cwd = await project(t, 'console.debug("debug");\n');
  await fs.writeFile(path.join(cwd, 'biome.json'), JSON.stringify({
    linter: { rules: { preset: 'none' } },
  }));
  assert.equal((await lint({ cwd })).exitCode, 0);
  const strict = await lint({ cwd, config: baseline });
  assert.notEqual(strict.exitCode, 0);
  assert.match(strict.stderr + strict.stdout, /noConsole/);
  assert.notEqual((await lint({ cwd, config: 'missing.json' })).exitCode, 0);
  await fs.writeFile(path.join(cwd, 'biome.json'), '{ invalid');
  assert.notEqual((await lint({ cwd })).exitCode, 0);
  await assert.rejects(lint({ cwd, paths: [] }), /Lint paths/);
  await assert.rejects(lint({ cwd, write: 'yes' }), /boolean/);
  await assert.rejects(lint({ cwd, config: '' }), /non-empty/);
});

test('lint CLI runs outside its checkout, reports failures and never invokes a build', async (t) => {
  const cwd = await project(t);
  const { stdout, stderr } = await execute(process.execPath, [cli, 'lint', '--cwd', cwd], { cwd: os.tmpdir() });
  assert.match(stdout + stderr, /Checked 1 file/);
  await fs.writeFile(path.join(cwd, 'src/index.js'), 'console.debug("debug");\n');
  await assert.rejects(execute(process.execPath, [cli, 'lint', '--cwd', cwd]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /noConsole/);
    return true;
  });
  const help = await execute(process.execPath, [cli, 'lint', '--help']);
  assert.match(help.stdout, /Lint options:/);
  await assert.rejects(fs.access(path.join(cwd, 'dist')));
});

test('package exports lint API and ships baseline and Biome as a runtime dependency', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./biome.json'], './src/biome-preset.json');
  assert.equal(manifest.exports['./lint'], './src/lint.mjs');
  assert.ok(manifest.files.includes('src/'));
  assert.ok(manifest.dependencies['@biomejs/biome']);
  const { lint: exportedLint } = await import('@esmj/cns-static-content-cli/lint');
  assert.equal(exportedLint, lint);
});