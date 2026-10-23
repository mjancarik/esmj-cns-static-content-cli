import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { parseArguments, toProjectRelativePosixPath } from '../src/build.mjs';

test('parseArguments provides build defaults', () => {
  const options = parseArguments([]);

  assert.equal(options.entry, 'src/index.html');
  assert.equal(options.outDir, 'dist');
  assert.deepEqual(options.purgeContent, ['src/**/*.html', 'src/**/*.js']);
  assert.deepEqual(options.purgeIgnore, ['src/purgeignore.css']);
  assert.equal(options.purge, true);
  assert.equal(options.clipboard, true);
});

test('parseArguments supports output, PurgeCSS, and clipboard options', () => {
  const options = parseArguments([
    '--cwd', '/tmp/project',
    '--entry', 'app.html',
    '--out-dir', 'artifacts',
    '--purge-content', 'public/**/*.html',
    '--purge-ignore', 'src/keep.css',
    '--no-clipboard',
    '--verbose',
  ]);

  assert.equal(options.cwd, '/tmp/project');
  assert.equal(options.entry, 'app.html');
  assert.equal(options.outDir, 'artifacts');
  assert.deepEqual(options.purgeContent, ['src/**/*.html', 'src/**/*.js', 'public/**/*.html']);
  assert.deepEqual(options.purgeIgnore, ['src/purgeignore.css', 'src/keep.css']);
  assert.equal(options.clipboard, false);
  assert.equal(options.verbose, true);
});

test('parseArguments supports dev server settings', () => {
  const options = parseArguments([
    '--dev',
    '--watch',
    '--open',
    '--no-purge',
    '--port', '4321',
    '--host', '127.0.0.1',
  ]);

  assert.equal(options.dev, true);
  assert.equal(options.watch, true);
  assert.equal(options.open, true);
  assert.equal(options.purge, false);
  assert.equal(options.port, 4321);
  assert.equal(options.host, '127.0.0.1');
});

test('toProjectRelativePosixPath normalizes Windows-style paths for es-check', () => {
  assert.equal(
    toProjectRelativePosixPath('C:\\repo\\project', 'C:\\repo\\project\\dist\\staticContent.js', path.win32),
    'dist/staticContent.js'
  );
  assert.equal(
    toProjectRelativePosixPath('/repo/project', '/repo/project/custom-output/staticContent.js', path.posix),
    'custom-output/staticContent.js'
  );
});

test('parseArguments rejects unknown and incomplete options', () => {
  assert.throws(() => parseArguments(['--unexpected']), /Unknown option/);
  assert.throws(() => parseArguments(['--entry']), /Missing value/);
  assert.throws(() => parseArguments(['--port']), /Missing value/);
});