import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import parcel from '@parcel/core';
import parcelUtils from '@parcel/utils';
import { createDevProxyServer, loadDevProxyConfig } from './dev-proxy.mjs';
import { loadProjectPage } from './project-page.mjs';

const require = createRequire(import.meta.url);
const [entry, outDir, portValue, host, publicUrl, open] = process.argv.slice(2);
const port = Number(portValue);
process.env.NODE_ENV = 'development';

let subscription;
let proxyServer;
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
  subscription = await bundler.watch((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
  });
  if (open === 'true') await parcelUtils.openInBrowser(`http://${host}:${port}${page}`);
  const stop = async () => {
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
