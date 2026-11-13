import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import parcel from '@parcel/core';
import parcelUtils from '@parcel/utils';

const require = createRequire(import.meta.url);
const [entry, outDir, portValue, host, publicUrl, open] = process.argv.slice(2);
const port = Number(portValue);
process.env.NODE_ENV = 'development';

let subscription;
try {
  const bundler = new parcel.Parcel({
    entries: entry,
    defaultConfig: fileURLToPath(new URL('./parcel-config.json', import.meta.url)),
    mode: 'development',
    shouldDisableCache: true,
    shouldContentHash: false,
    shouldAutoInstall: true,
    hmrOptions: { port, host },
    serveOptions: { port, host, publicUrl },
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
  if (open === 'true') await parcelUtils.openInBrowser(`http://${host}:${port}`);
  const stop = async () => {
    await subscription.unsubscribe();
    process.exit();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  if (subscription) await subscription.unsubscribe();
  console.error(error.message);
  process.exitCode = 1;
}
