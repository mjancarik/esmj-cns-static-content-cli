import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';

const TIMEOUT_MS = 10000;
const RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'location'];
const REQUEST_HEADERS = ['accept', 'accept-language', 'if-none-match', 'if-modified-since'];

export async function loadDevProxyConfig(projectDir) {
  const configPath = path.join(projectDir, '.cns-static-content.json');
  let contents;
  try {
    contents = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let config;
  try {
    config = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid dev config ${configPath}: ${error.message}`);
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Dev config must contain a JSON object.');
  }
  if (config.dev !== undefined && (!config.dev || Array.isArray(config.dev) || typeof config.dev !== 'object')) {
    throw new Error('dev must be an object.');
  }
  const proxy = config.dev?.proxy;
  if (proxy === undefined) return [];
  if (!proxy || Array.isArray(proxy) || typeof proxy !== 'object') throw new Error('dev.proxy must be an object.');
  const routes = Object.entries(proxy).map(([prefix, target]) => {
    if (!/^\/__proxy\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
      throw new Error(`Invalid dev proxy route: ${prefix}`);
    }
    if (typeof target !== 'string') throw new Error(`Dev proxy target for ${prefix} must be a URL string.`);
    let url;
    try {
      url = new URL(target);
    } catch {
      throw new Error(`Invalid dev proxy target for ${prefix}.`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(`Dev proxy target for ${prefix} must be an HTTP(S) URL without credentials, query, or fragment.`);
    }
    return { prefix, target: url.href };
  });
  for (const [index, route] of routes.entries()) {
    if (routes.some((other, otherIndex) => otherIndex !== index && other.prefix.startsWith(`${route.prefix}/`))) {
      throw new Error(`Overlapping dev proxy route: ${route.prefix}`);
    }
  }
  return routes;
}

function proxyTarget(route, requestUrl) {
  const queryIndex = requestUrl.indexOf('?');
  const pathname = queryIndex < 0 ? requestUrl : requestUrl.slice(0, queryIndex);
  const query = queryIndex < 0 ? '' : requestUrl.slice(queryIndex);
  const suffix = pathname.slice(route.prefix.length);
  for (const segment of suffix.split('/')) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error('Invalid URL encoding');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /%[0-9a-f]{2}/i.test(decoded)) {
      throw new Error('Invalid proxy path');
    }
  }
  const url = new URL(route.target);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix || '/'}`;
  url.search = query;
  return url;
}

function isLocalRequest(request, port) {
  const address = request.socket.remoteAddress;
  const ipv4 = address?.startsWith('::ffff:') ? address.slice(7) : address;
  if (address !== '::1' && !(net.isIPv4(ipv4) && ipv4.startsWith('127.'))) return false;
  let host;
  try {
    host = new URL(`http://${request.headers.host}`);
  } catch {
    return false;
  }
  if (host.username || host.password || host.host !== request.headers.host ||
    !['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || Number(host.port || 80) !== port) return false;
  if (request.headers.origin && request.headers.origin !== host.origin) return false;
  return !request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(request.headers['sec-fetch-site']);
}

function proxyLocation(route, target, location) {
  const redirect = new URL(location, target);
  const base = new URL(route.target);
  const basePath = base.pathname.replace(/\/$/, '');
  if (redirect.origin !== base.origin || redirect.username || redirect.password ||
    (redirect.pathname !== basePath && !redirect.pathname.startsWith(`${basePath}/`))) {
    throw new Error('Redirect outside configured target');
  }
  const localPath = `${route.prefix}${redirect.pathname.slice(basePath.length)}`;
  proxyTarget(route, `${localPath}${redirect.search}`);
  return `${localPath}${redirect.search}${redirect.hash}`;
}

function proxyApi(request, response, route, timeoutMs) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  let target;
  try {
    target = proxyTarget(route, request.url);
  } catch {
    response.writeHead(400).end('Invalid proxy path');
    return;
  }
  const headers = {};
  for (const name of REQUEST_HEADERS) {
    if (request.headers[name] !== undefined) headers[name] = request.headers[name];
  }
  const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request(target, { method: request.method, headers }, (result) => {
    const responseHeaders = {};
    for (const name of RESPONSE_HEADERS) {
      if (result.headers[name] !== undefined) responseHeaders[name] = result.headers[name];
    }
    if ([301, 302, 303, 307, 308].includes(result.statusCode) && responseHeaders.location) {
      try {
        responseHeaders.location = proxyLocation(route, target, responseHeaders.location);
      } catch {
        console.error(`Dev proxy ${route.prefix}: upstream redirect outside configured target`);
        result.resume();
        response.writeHead(502).end('Dev proxy upstream redirect not allowed');
        return;
      }
    }
    response.writeHead(result.statusCode, responseHeaders);
    result.once('error', () => response.destroy());
    result.once('aborted', () => response.destroy());
    result.pipe(response);
  });
  const timeout = setTimeout(() => upstream.destroy(new Error('timeout')), timeoutMs);
  timeout.unref();
  upstream.once('close', () => clearTimeout(timeout));
  upstream.once('error', (error) => {
    console.error(`Dev proxy ${route.prefix}: ${error.message === 'timeout' ? 'upstream timeout' : 'upstream request failed'}`);
    if (!response.headersSent) response.writeHead(error.message === 'timeout' ? 504 : 502).end('Dev proxy upstream unavailable');
    else response.destroy();
  });
  response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
  upstream.end();
}

function proxyParcel(request, response, parcelPort) {
  const upstream = http.request({
    hostname: '127.0.0.1', port: parcelPort, path: request.url, method: request.method, headers: request.headers,
  }, (result) => {
    response.writeHead(result.statusCode, result.headers);
    result.once('error', () => response.destroy());
    result.once('aborted', () => response.destroy());
    result.pipe(response);
  });
  upstream.once('error', () => {
    if (!response.headersSent) response.writeHead(502).end('Parcel dev server unavailable');
    else response.destroy();
  });
  request.pipe(upstream);
}

export function createDevProxyServer({ routes, port, parcelPort, timeoutMs = TIMEOUT_MS }) {
  const server = http.createServer((request, response) => {
    const pathname = request.url.split('?')[0];
    const route = routes.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (!route) return proxyParcel(request, response, parcelPort);
    if (!isLocalRequest(request, port)) return response.writeHead(403).end('Dev proxy requires a local same-origin request');
    return proxyApi(request, response, route, timeoutMs);
  });
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url.split('?')[0];
    if (routes.some(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = http.request({
      hostname: '127.0.0.1', port: parcelPort, path: request.url, method: request.method, headers: request.headers,
    });
    upstream.once('upgrade', (result, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/${result.httpVersion} ${result.statusCode} ${result.statusMessage}\r\n`);
      for (let index = 0; index < result.rawHeaders.length; index += 2) {
        socket.write(`${result.rawHeaders[index]}: ${result.rawHeaders[index + 1]}\r\n`);
      }
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
      socket.once('error', () => upstreamSocket.destroy());
      upstreamSocket.once('error', () => socket.destroy());
    });
    upstream.once('response', (result) => {
      socket.end(`HTTP/1.1 ${result.statusCode} ${result.statusMessage}\r\nConnection: close\r\n\r\n`);
      result.resume();
    });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });
  return server;
}
