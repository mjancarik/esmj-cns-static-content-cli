import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDevProxyServer, loadDevProxyConfig } from '../src/dev-proxy.mjs';

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return server.address().port;
}

test('dev proxy configuration validates routes and targets', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cns-dev-config-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const configPath = path.join(cwd, '.cns-static-content.json');
  assert.deepEqual(await loadDevProxyConfig(cwd), []);
  await fs.writeFile(configPath, JSON.stringify({ dev: { proxy: { '/__proxy/api': 'https://example.test/base' } } }));
  assert.deepEqual(await loadDevProxyConfig(cwd), [{ prefix: '/__proxy/api', target: 'https://example.test/base' }]);
  for (const proxy of [
    { '/api': 'https://example.test' },
    { '/__proxy/api': 'https://user:password@example.test' },
    { '/__proxy/api': 'https://example.test/?secret=value' },
    { '/__proxy/api': 'file:///etc/passwd' },
    { '/__proxy/api': 'https://example.test', '/__proxy/api/child': 'https://example.test' },
  ]) {
    await fs.writeFile(configPath, JSON.stringify({ dev: { proxy } }));
    await assert.rejects(loadDevProxyConfig(cwd), /proxy/i);
  }
});

test('dev proxy forwards only local read requests to configured routes', async (t) => {
  const requests = [];
  const upstreamPort = await listen(t, http.createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers, method: request.method });
    response.writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'secret=1' });
    response.end('{"ok":true}');
  }));
  const parcelPort = await listen(t, http.createServer((_request, response) => response.end('parcel')));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = createDevProxyServer({
    routes: [{ prefix: '/__proxy/api', target: `http://127.0.0.1:${upstreamPort}/base` }],
    port,
    parcelPort,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/__proxy/api/v1/items?filter=%7B%22x%22%3A1%7D`, {
    headers: { authorization: 'secret', cookie: 'secret=1', accept: 'application/json' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(requests[0].url, '/base/v1/items?filter=%7B%22x%22%3A1%7D');
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.accept, 'application/json');
  assert.equal((await fetch(`${base}/__proxy/api`, { method: 'HEAD' })).status, 201);
  assert.equal((await fetch(`${base}/__proxy/api`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/__proxy/api`, { headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(`${base}/__proxy/api/%2Foutside`)).status, 400);
  assert.equal((await fetch(`${base}/__proxy/api/%252e%252e/outside`)).status, 400);
  assert.equal((await fetch(`${base}/__proxy/api/%255coutside`)).status, 400);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/__proxy/api`, { headers: { host: `attacker@127.0.0.1:${port}` } }, (result) => {
      result.resume();
      resolve(result.statusCode);
    }).once('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal(await (await fetch(`${base}/__proxy/apix`)).text(), 'parcel');
  assert.equal(requests.length, 2);
});

test('dev proxy reports upstream failures and timeouts', async (t) => {
  const upstream = http.createServer((_request, _response) => {});
  const upstreamPort = await listen(t, upstream);
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = createDevProxyServer({
    routes: [
      { prefix: '/__proxy/timeout', target: `http://127.0.0.1:${upstreamPort}` },
      { prefix: '/__proxy/fail', target: 'http://127.0.0.1:1' },
    ],
    port,
    parcelPort: 1,
    timeoutMs: 50,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${port}/__proxy/timeout`)).status, 504);
  assert.equal((await fetch(`http://127.0.0.1:${port}/__proxy/fail`)).status, 502);
});

test('dev proxy requires a loopback socket even with a local Host header', async (t) => {
  const apiPort = await listen(t, http.createServer((_request, response) => response.end('ok')));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = createDevProxyServer({
    routes: [{ prefix: '/__proxy/api', target: `http://127.0.0.1:${apiPort}` }],
    port,
    parcelPort: 1,
  });
  let address;
  server.on('connection', (socket) => Object.defineProperty(socket, 'remoteAddress', { value: address }));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [remote, expected] of [
    ['127.1.2.3', 200], ['::1', 200], ['::ffff:127.0.0.1', 200],
    ['192.0.2.1', 403], ['::ffff:192.0.2.1', 403],
  ]) {
    address = remote;
    const response = await fetch(`http://127.0.0.1:${port}/__proxy/api`, { headers: { connection: 'close' } });
    assert.equal(response.status, expected);
    await response.text();
  }
});

test('dev proxy rewrites in-target redirects and rejects redirects outside the target', async (t) => {
  const apiPort = await listen(t, http.createServer((request, response) => {
    const locations = {
      '/base/root': '/base/items?filter=hello#section',
      '/base/relative': 'items?next=1',
      '/base/absolute': `http://127.0.0.1:${request.socket.localPort}/base/items`,
      '/base/external': 'https://other.example/items',
      '/base/outside': '/other/items',
      '/base/encoded': '/base/%252e%252e/items',
    };
    if (locations[request.url]) return response.writeHead(302, { location: locations[request.url] }).end();
    response.end(request.url);
  }));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = createDevProxyServer({
    routes: [{ prefix: '/__proxy/api', target: `http://127.0.0.1:${apiPort}/base` }],
    port,
    parcelPort: 1,
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${port}/__proxy/api`;
  for (const [source, expected] of [
    ['root', '/__proxy/api/items?filter=hello#section'],
    ['relative', '/__proxy/api/items?next=1'],
    ['absolute', '/__proxy/api/items'],
  ]) {
    const response = await fetch(`${base}/${source}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), expected);
    assert.match(await (await fetch(`${base}/${source}`)).text(), /^\/base\/items/);
  }
  for (const source of ['external', 'outside', 'encoded']) {
    assert.equal((await fetch(`${base}/${source}`, { redirect: 'manual' })).status, 502);
  }
});

test('dev proxy terminates the client response when Parcel aborts', async (t) => {
  const parcelPort = await listen(t, http.createServer((_request, response) => {
    response.writeHead(200, { 'content-length': '100' });
    response.write('partial');
    setTimeout(() => response.destroy(), 20);
  }));
  const proxy = createDevProxyServer({ routes: [], port: 0, parcelPort });
  const port = await listen(t, proxy);
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
  await assert.rejects(response.text(), /terminated|aborted/i);
});
