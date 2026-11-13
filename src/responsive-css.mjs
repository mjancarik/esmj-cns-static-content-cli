import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEFAULTS = {
  selector: 'main',
  minWidth: 320,
  maxWidth: 1600,
  step: 4,
  viewportHeight: 900,
  roundToRem: 0.25,
  includeAmpIframe: true,
  debug: false,
  waitForSelector: null,
  waitMs: 0,
};

export function normalizeResponsiveOptions(input = true) {
  const options = typeof input === 'object' && input !== null
    ? { ...DEFAULTS, ...input }
    : { ...DEFAULTS };
  if (input === false || input == null) return { ...options, enabled: false };
  if (input !== true && (typeof input !== 'object' || input === null)) {
    throw new Error('responsiveCss must be a boolean or options object.');
  }
  if (typeof options.selector !== 'string' || !options.selector.trim()) {
    throw new Error('responsiveCss.selector must be a non-empty CSS selector.');
  }
  for (const field of ['minWidth', 'maxWidth', 'step', 'viewportHeight']) {
    if (!Number.isSafeInteger(options[field]) || options[field] <= 0) {
      throw new Error(`responsiveCss.${field} must be a positive integer.`);
    }
  }
  if (options.minWidth >= options.maxWidth) {
    throw new Error('responsiveCss.minWidth must be less than responsiveCss.maxWidth.');
  }
  if (options.step > options.maxWidth - options.minWidth) {
    throw new Error('responsiveCss.step must be smaller than the responsive width range.');
  }
  if (typeof options.roundToRem !== 'number' || !Number.isFinite(options.roundToRem) || options.roundToRem <= 0) {
    throw new Error('responsiveCss.roundToRem must be a positive number.');
  }
  if (typeof options.includeAmpIframe !== 'boolean') {
    throw new Error('responsiveCss.includeAmpIframe must be a boolean.');
  }
  if (typeof options.debug !== 'boolean') {
    throw new Error('responsiveCss.debug must be a boolean.');
  }
  if (options.waitForSelector !== null && typeof options.waitForSelector !== 'string') {
    throw new Error('responsiveCss.waitForSelector must be a CSS selector string or null.');
  }
  if (!Number.isFinite(options.waitMs) || options.waitMs < 0) {
    throw new Error('responsiveCss.waitMs must be a non-negative number.');
  }
  return { ...options, enabled: true };
}

function roundTo(value, unit) {
  return Math.round(value / unit) * unit;
}

export function summarizeResponsiveMeasurements(measurements, roundToRem = 0.25) {
  if (!Array.isArray(measurements) || measurements.length === 0) {
    throw new Error('At least one responsive measurement is required.');
  }
  const normalized = measurements.map((measurement) => {
    if (!Number.isFinite(measurement.width) || measurement.width <= 0 ||
      !Number.isFinite(measurement.heightRem) || measurement.heightRem < 0) {
      throw new Error('Responsive measurements need positive widths and non-negative rem heights.');
    }
    return {
      width: measurement.width,
      heightRem: roundTo(measurement.heightRem, roundToRem),
      ampIframeVisible: Boolean(measurement.ampIframeVisible),
    };
  }).sort((a, b) => b.width - a.width);
  const segments = [{ ...normalized[0], maxWidth: null }];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const previous = segments.at(-1);
    if (current.heightRem !== previous.heightRem || current.ampIframeVisible !== previous.ampIframeVisible) {
      segments.push({ ...current, maxWidth: current.width });
    }
  }
  return segments;
}

export function formatResponsiveCss(measurements, { roundToRem = 0.25, includeAmpIframe = true } = {}) {
  const segments = summarizeResponsiveMeasurements(measurements, roundToRem);
  return `${segments.map((segment) => {
    const selectors = ['__CLASS__'];
    if (includeAmpIframe && segment.ampIframeVisible) selectors.push('__CLASS__ amp-iframe');
    const selector = selectors.join(', ');
    const indent = segment.maxWidth === null ? '' : '  ';
    const rule = `${indent}${selector} {\n${indent}  height: ${segment.heightRem}rem;\n${indent}}`;
    if (segment.maxWidth === null) return rule;
    return `@media only screen and (max-width: ${segment.maxWidth}px) {\n${rule}\n}`;
  }).join('\n\n')}\n`;
}

function startStaticServer(rootDirectory, indexFile) {
  const root = path.resolve(rootDirectory);
  const server = http.createServer(async (request, response) => {
    try {
      const rawPath = request.url.split('?')[0];
      const decodedPath = decodeURIComponent(rawPath);
      const relativePath = decodedPath === '/' ? indexFile : decodedPath.replace(/^\/+/, '');
      const target = path.resolve(root, relativePath);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      let data = await fs.readFile(target);
      const extension = path.extname(target).toLowerCase();
      const type = extension === '.html' ? 'text/html; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8'
          : extension === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
      if (rawPath === '/') {
        data = Buffer.from(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main data-cns-responsive-root>${data.toString('utf8')}</main></body></html>`);
      }
      response.writeHead(200, { 'content-type': type, 'content-length': data.length });
      response.end(data);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => server.close((error) => error ? closeReject(error) : closeResolve())),
      });
    });
  });
}

export async function generateResponsiveCss({ htmlPath, outputPath, options = true }) {
  const settings = normalizeResponsiveOptions(options);
  if (!settings.enabled) return null;
  const { chromium } = await import('playwright');
  const server = await startStaticServer(path.dirname(htmlPath), path.basename(htmlPath));
  let browser;
  try {
    try {
      browser = await chromium.launch({
        headless: !settings.debug,
        ...(settings.debug ? { slowMo: 100 } : {}),
      });
    } catch (error) {
      if (!error.message.includes("Executable doesn't exist")) throw error;
      const { version } = require('playwright/package.json');
      throw new Error(`${error.message}\nInstall the CLI's matching Chromium with: npx --yes playwright@${version} install chromium`, { cause: error });
    }
    const page = await browser.newPage({
      viewport: { width: settings.maxWidth, height: settings.viewportHeight },
    });
    await page.goto(`${server.url}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (settings.waitForSelector) await page.locator(settings.waitForSelector).waitFor();
    if (settings.waitMs > 0) await page.waitForTimeout(settings.waitMs);
    const targetSelector = settings.selector === 'main'
      ? 'main[data-cns-responsive-root]'
      : settings.selector;
    const target = page.locator(targetSelector);
    const count = await target.count();
    if (count === 0) {
      throw new Error(`Responsive CSS target not found: ${settings.selector}`);
    }

    const actualMeasurements = [];
    const widths = [];
    for (let width = settings.maxWidth; width >= settings.minWidth; width -= settings.step) widths.push(width);
    if (widths.at(-1) !== settings.minWidth) widths.push(settings.minWidth);
    for (const width of widths) {
      await page.setViewportSize({ width, height: settings.viewportHeight });
      actualMeasurements.push(await target.evaluate((element, includeAmpIframe) => {
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const rect = element.getBoundingClientRect();
        const height = Math.max(element.scrollHeight, rect.height, element.clientHeight);
        const iframe = element.querySelector('amp-iframe');
        const iframeRect = iframe?.getBoundingClientRect();
        const style = iframe ? getComputedStyle(iframe) : null;
        return {
          width: window.innerWidth,
          heightRem: height / rootFontSize,
          ampIframeVisible: Boolean(includeAmpIframe && iframe && iframeRect.width > 0 && iframeRect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'),
        };
      }, settings.includeAmpIframe));
    }
    const css = formatResponsiveCss(actualMeasurements, settings);
    await fs.writeFile(outputPath, css, 'utf8');
    return { outputPath, css, measurements: summarizeResponsiveMeasurements(actualMeasurements, settings.roundToRem) };
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}
