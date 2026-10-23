#!/usr/bin/env node
import { build, parseArguments, serve } from './build.mjs';

const help = `Usage: esmj-cns-static-content-cli [options]

Build a Parcel HTML entry and export static HTML, CSS, and JavaScript.

Options:
  --cwd <directory>          Project directory (default: current directory)
  --entry <file>             HTML entry relative to the project (default: src/index.html)
  --out-dir <directory>      Output directory relative to the project (default: dist)
  --purge-content <path>     Additional PurgeCSS content path (repeatable)
  --purge-ignore <file>      CSS selectors to preserve (repeatable)
  --no-clipboard             Do not copy the generated HTML
  --no-purge                Disable PurgeCSS cleanup entirely
  --dev                     Start a Parcel dev server with watch mode and HMR
  --watch                   Alias for --dev
  --open                    Open the generated URL in the browser
  --port <port>             Dev server port (default: 1234)
  --host <host>             Dev server host (default: 127.0.0.1)
  --verbose                 Print bundler output
  -h, --help                Show help
`;

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(help);
      return;
    }

    if (options.dev || options.watch) {
      const server = await serve(options);
      process.stdout.write(`Dev server running at ${server.url}\n`);
      return;
    }

    const result = await build(options);
    process.stdout.write(`Created ${result.outputs.html}\n`);
    process.stdout.write(`Created ${result.outputs.css}\n`);
    process.stdout.write(`Created ${result.outputs.js}\n`);
    if (result.clipboardWritten) {
      process.stdout.write('Copied static HTML to clipboard.\n');
    } else if (result.clipboardWarning) {
      process.stderr.write(`${result.clipboardWarning}\n`);
    }
  } catch (error) {
    process.stderr.write(`koderi-static-build: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
