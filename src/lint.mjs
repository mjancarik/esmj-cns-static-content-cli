import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const defaultConfig = fileURLToPath(new URL('./biome-preset.json', import.meta.url));

export function parseLintArguments(argv) {
  const options = { cwd: process.cwd(), paths: [], write: false, help: false };
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (positionalOnly) {
      options.paths.push(arg);
    } else if (arg === '--') {
      positionalOnly = true;
    } else if (arg === '--write') {
      options.write = true;
    } else if (arg === '--unsafe') {
      options.unsafe = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--cwd' || arg === '--config') {
      const value = argv[index + 1];
      if (!value?.trim() || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      options[arg === '--cwd' ? 'cwd' : 'config'] = value;
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown lint option: ${arg}`);
    } else {
      options.paths.push(arg);
    }
  }
  if (options.paths.length === 0) options.paths.push('src');
  return options;
}

async function hasProjectConfig(cwd) {
  let directory = cwd;
  while (true) {
    for (const name of ['biome.json', 'biome.jsonc']) {
      try {
        await fs.access(path.join(directory, name));
        return true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

export async function lint({ cwd = process.cwd(), paths = ['src'], config, write = false, unsafe = false } = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Lint paths must be a non-empty array of file or directory paths.');
  }
  if (typeof write !== 'boolean') throw new Error('Lint write must be a boolean.');
  if (typeof unsafe !== 'boolean') throw new Error('Lint unsafe must be a boolean.');
  if (unsafe && !write) throw new Error('Lint --unsafe requires --write.');
  if (config !== undefined && (typeof config !== 'string' || !config.trim())) {
    throw new Error('Lint config must be a non-empty file or directory path.');
  }
  const projectDir = path.resolve(cwd);
  const configPath = config !== undefined
    ? path.resolve(projectDir, config)
    : await hasProjectConfig(projectDir) ? null : defaultConfig;
  const packagePath = require.resolve('@biomejs/biome/package.json');
  const biomeBin = path.resolve(path.dirname(packagePath), require(packagePath).bin.biome);
  const args = ['lint'];
  if (configPath) args.push('--config-path', configPath);
  if (write) args.push('--write');
  if (unsafe) args.push('--unsafe');
  // Resolve paths ourselves so paths beginning with '-' cannot become Biome flags.
  args.push(...paths.map((value) => path.resolve(projectDir, value)));

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Config selection belongs to this command, not the caller's shell environment.
    delete env.BIOME_CONFIG_PATH;
    const child = spawn(process.execPath, [biomeBin, ...args], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      if (signal) {
        reject(new Error(`Biome terminated by ${signal}.`));
      } else {
        resolve({ exitCode, stdout, stderr });
      }
    });
  });
}