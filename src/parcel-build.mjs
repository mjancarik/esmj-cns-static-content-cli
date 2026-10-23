import { createRequire } from 'node:module';
import parcel from '@parcel/core';
import { BROWSER_TARGETS } from './browser-targets.mjs';

const require = createRequire(import.meta.url);
const { Parcel } = parcel;
const [entry, outDir, verbose] = process.argv.slice(2);

// Run in a child process so Parcel workers and project cwd remain isolated.
try {
  const bundler = new Parcel({
    entries: entry,
    defaultConfig: require.resolve('@parcel/config-default'),
    mode: 'production',
    shouldAutoInstall: false,
    targets: {
      default: {
        context: 'browser',
        engines: { browsers: [...BROWSER_TARGETS] },
        distDir: outDir,
        includeNodeModules: true,
        sourceMap: false,
      },
    },
  });
  const { bundleGraph } = await bundler.run();
  if (verbose === 'true') {
    for (const bundle of bundleGraph.getBundles()) {
      console.log(`Built ${bundle.filePath}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}