import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import clipboardy from 'clipboardy';
import { BROWSER_TARGETS } from './browser-targets.mjs';
import cssbeautify from 'cssbeautify';
import { JSDOM } from 'jsdom';
import htmlpretty from 'pretty';
import purgecssPackage from 'purgecss';

const require = createRequire(import.meta.url);
const { PurgeCSS } = purgecssPackage;

const DEFAULTS = {
  cwd: process.cwd(),
  entry: 'src/index.html',
  outDir: 'dist',
  purge: true,
  purgeContent: ['src/**/*.html', 'src/**/*.js'],
  purgeIgnore: ['src/purgeignore.css'],
  clipboard: true,
  verbose: false,
  dev: false,
  watch: false,
  open: false,
  port: 1234,
  host: '127.0.0.1',
  help: false,
};

const VALUE_OPTIONS = new Set([
  '--cwd',
  '--entry',
  '--out-dir',
  '--purge-content',
  '--purge-ignore',
  '--port',
  '--host',
]);

function getPackageBin(packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = require(packageJsonPath);
  const bin =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.[packageName] ??
        Object.values(packageJson.bin ?? {})[0];

  if (!bin) {
    throw new Error(`Unable to resolve binary for ${packageName}.`);
  }

  return path.join(path.dirname(packageJsonPath), bin);
}

function runNodeBin(packageName, args, options = {}) {
  return runNodeFile(getPackageBin(packageName), args, options);
}

function runNodeFile(filePath, args, options = {}) {
  const { cwd, verbose = false, env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [filePath, ...args],
      {
        cwd,
        env: { ...process.env, ...env },
        stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    if (!verbose) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim();
      reject(new Error(detail || `${path.basename(filePath)} exited with code ${code}.`));
    });
  });
}

function withDefaults(inputOptions = {}) {
  return {
    ...DEFAULTS,
    ...inputOptions,
    purge: inputOptions.purge ?? DEFAULTS.purge,
    purgeContent: inputOptions.purgeContent ?? DEFAULTS.purgeContent,
    purgeIgnore: inputOptions.purgeIgnore ?? DEFAULTS.purgeIgnore,
    clipboard: inputOptions.clipboard ?? DEFAULTS.clipboard,
    verbose: inputOptions.verbose ?? DEFAULTS.verbose,
    dev: inputOptions.dev ?? DEFAULTS.dev,
    watch: inputOptions.watch ?? DEFAULTS.watch,
    open: inputOptions.open ?? DEFAULTS.open,
    port: inputOptions.port ?? DEFAULTS.port,
    host: inputOptions.host ?? DEFAULTS.host,
    help: inputOptions.help ?? DEFAULTS.help,
  };
}

export function toProjectRelativePosixPath(projectDir, absoluteFilePath, platformPath = path) {
  const relativePath = platformPath.relative(projectDir, absoluteFilePath);
  return relativePath.split(platformPath.sep).join('/');
}

async function walkProjectFiles(projectDir, extensions = []) {
  const result = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (extensions.length === 0 || extensions.includes(extension)) {
          result.push(absolutePath);
        }
      }
    }
  }

  await visit(projectDir);
  return result;
}

function globToRegExp(pattern) {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

  if (normalized === '**/*.html') {
    return /^(?:.*\/)?[^/]+\.html$/i;
  }

  if (normalized === '**/*.js') {
    return /^(?:.*\/)?[^/]+\.js$/i;
  }

  let regex = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '*') {
      if (normalized[index + 1] === '*') {
        regex += '.*';
        index += 1;
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    if (/[|\\{}()[\]^$+?.]/.test(char)) {
      regex += `\\${char}`;
      continue;
    }

    regex += char;
  }

  return new RegExp(`^${regex}$`);
}

async function expandPurgeTargets(projectDir, targetList, extensions = []) {
  const expanded = new Set();
  const candidates = Array.isArray(targetList) ? targetList : [targetList];

  if (!candidates.length) {
    const files = await walkProjectFiles(projectDir, extensions);
    for (const file of files) {
      expanded.add(file);
    }
    return [...expanded];
  }

  for (const target of candidates) {
    if (!target) {
      continue;
    }

    const absoluteTarget = path.resolve(projectDir, target);

    if (await fileExists(absoluteTarget)) {
      const stats = await fs.stat(absoluteTarget);
      if (stats.isDirectory()) {
        const files = await walkProjectFiles(absoluteTarget, extensions);
        for (const file of files) {
          expanded.add(file);
        }
      } else {
        expanded.add(absoluteTarget);
      }
      continue;
    }

    if (/[*?[]/.test(target)) {
      const regex = globToRegExp(target);
      const files = await walkProjectFiles(projectDir, extensions);

      for (const file of files) {
        const relativePath = path.relative(projectDir, file).split(path.sep).join('/');
        if (regex.test(relativePath)) {
          expanded.add(file);
        }
      }
    }
  }

  if (expanded.size === 0) {
    const files = await walkProjectFiles(projectDir, extensions);
    for (const file of files) {
      expanded.add(file);
    }
  }

  return [...expanded];
}

function resolveProjectPath(projectDir, targetPath) {
  return path.resolve(projectDir, targetPath);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectExistingPaths(pathsToCheck) {
  const existingPaths = [];

  for (const filePath of pathsToCheck) {
    if (await fileExists(filePath)) {
      existingPaths.push(filePath);
    }
  }

  return existingPaths;
}

function isLocalAssetPath(rawValue) {
  return Boolean(
    rawValue && !/^https?:\/\//i.test(rawValue) && !rawValue.startsWith('data:')
  );
}

function getAssetPath(element, attributeName) {
  const rawValue = element?.getAttribute(attributeName);

  return isLocalAssetPath(rawValue) ? rawValue : null;
}

function toBundlePath(outDir, rawAssetPath) {
  if (!rawAssetPath) {
    return null;
  }

  const relativeAssetPath = decodeURIComponent(
    rawAssetPath.split(/[?#]/)[0]
  ).replace(/^\//, '');

  return path.join(outDir, relativeAssetPath);
}

function getAssetMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.otf':
      return 'font/otf';
    case '.ttf':
      return 'font/ttf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return null;
  }
}

function resolveLocalAssetPath(baseDir, rawAssetPath) {
  if (!rawAssetPath || !isLocalAssetPath(rawAssetPath)) {
    return null;
  }

  const cleanedPath = decodeURIComponent(rawAssetPath.split(/[?#]/)[0]).replace(
    /^\/+/, ''
  );

  if (!cleanedPath) {
    return null;
  }

  return path.resolve(baseDir, cleanedPath);
}

async function inlineLocalAssetReferences(html, css, outDir) {
  let nextHtml = html;
  const htmlPattern = /(src|href)=(["'])([^"']+)\2/gi;

  for (const match of [...html.matchAll(htmlPattern)]) {
    const rawValue = match[3];
    const assetPath = resolveLocalAssetPath(outDir, rawValue);

    if (!assetPath || !(await fileExists(assetPath))) {
      continue;
    }

    const mimeType = getAssetMimeType(assetPath);
    if (!mimeType) {
      continue;
    }

    const encoded = (await fs.readFile(assetPath)).toString('base64');
    const dataUrl = `data:${mimeType};base64,${encoded}`;
    nextHtml = nextHtml.replace(match[0], `${match[1]}=${match[2]}${dataUrl}${match[2]}`);
  }

  let nextCss = css;
  const cssPattern = /url\((['"]?)([^'")]+)\1\)/gi;

  for (const match of [...css.matchAll(cssPattern)]) {
    const rawValue = match[2];
    const assetPath = resolveLocalAssetPath(outDir, rawValue);

    if (!assetPath || !(await fileExists(assetPath))) {
      continue;
    }

    const mimeType = getAssetMimeType(assetPath);
    if (!mimeType) {
      continue;
    }

    const encoded = (await fs.readFile(assetPath)).toString('base64');
    const dataUrl = `data:${mimeType};base64,${encoded}`;
    nextCss = nextCss.replace(
      match[0],
      `url(${match[1] || ''}${dataUrl}${match[1] || ''})`
    );
  }

  return { html: nextHtml, css: nextCss };
}

async function loadBundleArtifacts(indexHtmlPath) {
  const html = await fs.readFile(indexHtmlPath, 'utf-8');
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const scripts = Array.from(document.querySelectorAll('script'));
    const hasModule = scripts.some((node) => node.type === 'module');
    const cssBlocks = [];
    const jsBlocks = [];
    const outDir = path.dirname(indexHtmlPath);

    for (const node of document.querySelectorAll(
      'style, link[rel="stylesheet"]'
    )) {
      if (node.tagName === 'STYLE') {
        cssBlocks.push(node.textContent);
        node.remove();
      } else {
        const asset = getAssetPath(node, 'href');
        if (asset) {
          cssBlocks.push(
            await fs.readFile(toBundlePath(outDir, asset), 'utf8')
          );
          node.remove();
        }
      }
    }

    for (const node of scripts) {
      const type = node.type.toLowerCase();
      if (
        type &&
        !['module', 'text/javascript', 'application/javascript'].includes(type)
      ) {
        continue; // Keep JSON/configuration scripts in the markup.
      }
      if (hasModule && node.hasAttribute('nomodule')) {
        node.remove(); // Alternative bundle, not a second application entry.
        continue;
      }
      const src = node.getAttribute('src');
      if (src) {
        const asset = getAssetPath(node, 'src');
        if (!asset) continue;
        jsBlocks.push(await fs.readFile(toBundlePath(outDir, asset), 'utf8'));
      } else {
        jsBlocks.push(node.textContent);
      }
      node.remove();
    }

    const content = document.querySelector('main') ?? document.body;
    return {
      mainHtml: htmlpretty(content.innerHTML),
      css: cssBlocks.join('\n\n'),
      js: jsBlocks.join('\n;\n'),
    };
  } finally {
    dom.window.close();
  }
}

async function purgeBuiltCss({
  outDir,
  indexHtmlPath,
  purgeContent,
  purgeIgnore,
}) {
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const cssFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => path.join(outDir, entry.name));
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(outDir, entry.name));

  if (cssFiles.length === 0) {
    return;
  }

  const additionalContent = await collectExistingPaths([
    ...purgeContent,
    ...purgeIgnore,
  ]);
  const purge = new PurgeCSS();
  const result = await purge.purge({
    css: cssFiles,
    content: [indexHtmlPath, ...jsFiles, ...additionalContent],
  });

  await Promise.all(
    result.map((asset) => fs.writeFile(asset.file, asset.css, 'utf-8'))
  );
}

function formatStaticHtml(mainHtml, css, js) {
  return `\n<style>\n${css}\n</style>\n\n${mainHtml}\n\n<script>\n${js}\n</script>\n`;
}

async function writeClipboard(staticHtml) {
  try {
    clipboardy.writeSync(staticHtml);
    return {
      clipboardWritten: true,
      clipboardWarning: null,
    };
  } catch (error) {
    return {
      clipboardWritten: false,
      clipboardWarning: `Clipboard unavailable: ${error.message}`,
    };
  }
}

export function parseArguments(argv) {
  const options = {
    ...DEFAULTS,
    purgeContent: [...DEFAULTS.purgeContent],
    purgeIgnore: [...DEFAULTS.purgeIgnore],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--no-clipboard') {
      options.clipboard = false;
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }

    if (arg === '--no-purge') {
      options.purge = false;
      continue;
    }

    if (arg === '--dev') {
      options.dev = true;
      continue;
    }

    if (arg === '--watch') {
      options.watch = true;
      options.dev = true;
      continue;
    }

    if (arg === '--open') {
      options.open = true;
      continue;
    }

    if (!VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    index += 1;

    if (arg === '--cwd') {
      options.cwd = value;
    } else if (arg === '--entry') {
      options.entry = value;
    } else if (arg === '--out-dir') {
      options.outDir = value;
    } else if (arg === '--purge-content') {
      options.purgeContent.push(value);
    } else if (arg === '--purge-ignore') {
      options.purgeIgnore.push(value);
    } else if (arg === '--port') {
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid value for ${arg}: ${value}`);
      }
      options.port = port;
    } else if (arg === '--host') {
      options.host = value;
    }
  }

  return options;
}

export async function serve(inputOptions = {}) {
  const options = withDefaults(inputOptions);
  const projectDir = path.resolve(options.cwd);
  const entryPath = resolveProjectPath(projectDir, options.entry);

  if (!(await fileExists(entryPath))) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const parcelArgs = [
    'serve',
    `./${path.relative(projectDir, entryPath)}`,
    '--dist-dir',
    options.outDir,
    '--port',
    String(options.port),
    '--host',
    options.host,
    '--no-cache',
  ];

  if (options.open) {
    parcelArgs.push('--open');
  }

  await runNodeBin('parcel', parcelArgs,
    {
      cwd: projectDir,
      verbose: true,
      env: {
        BROWSERSLIST: BROWSER_TARGETS.join(', '),
      },
    }
  );

  return {
    url: `http://${options.host}:${options.port}`,
  };
}

export async function build(inputOptions = {}) {
  const options = withDefaults(inputOptions);
  const projectDir = path.resolve(options.cwd);
  const entryPath = resolveProjectPath(projectDir, options.entry);
  const outDir = resolveProjectPath(projectDir, options.outDir);
  const indexHtmlPath = path.join(outDir, path.basename(options.entry));
  const purgeContent = await expandPurgeTargets(projectDir, options.purgeContent, ['.html', '.js']);
  const purgeIgnore = await expandPurgeTargets(projectDir, options.purgeIgnore, ['.css']);

  if (!(await fileExists(entryPath))) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  await runNodeFile(
    fileURLToPath(new URL('./parcel-build.mjs', import.meta.url)),
    [
      `./${path.relative(projectDir, entryPath)}`,
      outDir,
      String(options.verbose),
    ],
    { cwd: projectDir, verbose: options.verbose }
  );

  if (options.purge) {
    await purgeBuiltCss({
      outDir,
      indexHtmlPath,
      purgeContent,
      purgeIgnore,
    });
  }

  const { mainHtml, css, js } = await loadBundleArtifacts(indexHtmlPath);

  if (!css) {
    throw new Error(`Unable to extract CSS from ${indexHtmlPath}.`);
  }

  if (!js) {
    throw new Error(`Unable to extract JavaScript from ${indexHtmlPath}.`);
  }

  const inlined = await inlineLocalAssetReferences(mainHtml, css, outDir);
  const formattedCss = cssbeautify(inlined.css, {
    indent: '  ',
    openbrace: 'end-of-line',
    autosemicolon: true,
  });
  const staticHtml = formatStaticHtml(inlined.html, formattedCss, js);
  const staticHtmlPath = path.join(outDir, 'staticContent.html');
  const staticCssPath = path.join(outDir, 'staticContent.css');
  const staticJsPath = path.join(outDir, 'staticContent.js');

  await fs.writeFile(staticHtmlPath, staticHtml, 'utf-8');
  await fs.writeFile(staticCssPath, formattedCss, 'utf-8');
  await fs.writeFile(staticJsPath, js, 'utf-8');

  const esCheckEntry = toProjectRelativePosixPath(projectDir, staticJsPath);

  await runNodeBin('es-check', ['es9', esCheckEntry, '--module'], {
    cwd: projectDir,
    verbose: options.verbose,
  });

  const clipboardResult = options.clipboard
    ? await writeClipboard(staticHtml)
    : {
        clipboardWritten: false,
        clipboardWarning: null,
      };

  return {
    outputs: {
      html: staticHtmlPath,
      css: staticCssPath,
      js: staticJsPath,
    },
    ...clipboardResult,
  };
}
