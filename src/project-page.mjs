import fs from 'node:fs/promises';
import path from 'node:path';

export function normalizeProjectPage(page = '/') {
  if (typeof page !== 'string' || !page.startsWith('/') || page.startsWith('//') ||
    page.includes('\\') || [...page].some((character) => character.charCodeAt(0) <= 32)) {
    throw new Error('page must be a local absolute path, optionally with a query string or fragment.');
  }
  const url = new URL(page, 'http://localhost');
  if (url.origin !== 'http://localhost') {
    throw new Error('page must be a local absolute path, optionally with a query string or fragment.');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function loadProjectPage(projectDir) {
  const configPath = path.join(projectDir, '.cns-static-content.json');
  let contents;
  try {
    contents = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '/';
    throw error;
  }
  let config;
  try {
    config = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid project config ${configPath}: ${error.message}`);
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Project config must contain a JSON object.');
  }
  return normalizeProjectPage(config.page);
}
