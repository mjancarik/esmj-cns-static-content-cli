import { createRequire } from 'node:module';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import parcel from '@parcel/core';
import parcelUtils from '@parcel/utils';
import { createDevProxyServer, loadDevProxyConfig } from './dev-proxy.mjs';
import { loadProjectPage } from './project-page.mjs';

const require = createRequire(import.meta.url);
const [entry, outDir, portValue, host, publicUrl, open] = process.argv.slice(2);
const port = Number(portValue);
process.env.NODE_ENV = 'development';

async function waitForPreview(url, signal) {
  const deadline = Date.now() + 30000;
  let lastFailure = 'server did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(1000, deadline - Date.now()))]),
      });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      if (signal.aborted) throw error;
      lastFailure = error.name === 'TimeoutError' ? 'request timed out' : 'server did not respond';
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(100, remaining), undefined, { signal });
  }
  throw new Error(`Dev preview did not become ready within 30 seconds (${lastFailure}).`);
}

let subscription;
let proxyServer;
const previewAbort = new AbortController();
try {
  const routes = await loadDevProxyConfig(process.cwd());
  const page = await loadProjectPage(process.cwd());
  let parcelPort = port;
  if (routes.length) {
    const temporaryServer = net.createServer();
    await new Promise((resolve, reject) => {
      temporaryServer.once('error', reject);
      temporaryServer.listen(0, '127.0.0.1', resolve);
    });
    parcelPort = temporaryServer.address().port;
    await new Promise((resolve, reject) => temporaryServer.close((error) => error ? reject(error) : resolve()));
    proxyServer = createDevProxyServer({ routes, port, parcelPort });
    await new Promise((resolve, reject) => {
      proxyServer.once('error', reject);
      proxyServer.listen(port, host, resolve);
    });
    for (const { prefix } of routes) console.log(`Dev proxy enabled: ${prefix}`);
  }
  const bundler = new parcel.Parcel({
    entries: entry,
    defaultConfig: fileURLToPath(new URL('./parcel-config.json', import.meta.url)),
    mode: 'development',
    shouldDisableCache: true,
    shouldContentHash: false,
    shouldAutoInstall: true,
    hmrOptions: { port: parcelPort, host },
    serveOptions: { port: parcelPort, host: routes.length ? '127.0.0.1' : host, publicUrl },
    defaultTargetOptions: { publicUrl, distDir: outDir },
    additionalReporters: [{
      packageName: '@parcel/reporter-cli',
      resolveFrom: require.resolve('parcel/package.json'),
    }],
  });
  const browserHost = host === '0.0.0.0' ? '127.0.0.1'
    : host === '::' ? '[::1]' : net.isIP(host) === 6 ? `[${host}]` : host;
  const previewUrl = `http://${browserHost}:${port}${page}`;
  let shouldOpen = open === 'true';
  let opening = false;
  subscription = await bundler.watch((error, event) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (shouldOpen && !opening && event?.type === 'buildSuccess') {
      opening = true;
      waitForPreview(previewUrl, previewAbort.signal)
        .then(async () => {
          if (previewAbort.signal.aborted) return;
          shouldOpen = false;
          await parcelUtils.openInBrowser(previewUrl);
        })
        .catch((openError) => {
          if (!previewAbort.signal.aborted) {
            opening = false;
            console.error(`Unable to open dev preview: ${openError.message}`);
          }
        });
    }
  });
  const stop = async () => {
    previewAbort.abort();
    await subscription.unsubscribe();
    if (proxyServer) await new Promise((resolve, reject) => proxyServer.close((error) => error ? reject(error) : resolve()));
    process.exit();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  if (subscription) await subscription.unsubscribe();
  if (proxyServer?.listening) await new Promise((resolve, reject) => proxyServer.close((closeError) => closeError ? reject(closeError) : resolve()));
  console.error(error.message);
  process.exitCode = 1;
}
