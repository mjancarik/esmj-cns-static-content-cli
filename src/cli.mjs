#!/usr/bin/env node
import fs from 'node:fs/promises';
import { build, parseArguments, serve } from './build.mjs';
import { lint, parseLintArguments } from './lint.mjs';
import {
  loadVerifyConfig,
  parseVerifyArguments,
  runVerify,
  testE2e,
  testRegression,
  testSize,
  testUnit,
} from './verify.mjs';

const help = `Usage: esmj-cns-static-content-cli [options]

Build a Parcel HTML entry and export static HTML, CSS, and JavaScript.

Commands:
  lint [paths...]           Lint source files with Biome (default: src)
  verify                    Run unit, size, E2E, and visual regression checks
  test:unit                 Run project Jest unit tests
  test:size                 Build and check HTML/CSS/JS size limits
  test:e2e                  Build, serve, and run project Playwright tests
  test:regression            Compare dev and production browser screenshots

Verify options:
  --cwd <directory>         Project directory (default: current directory)
  --config <path>           Verify JSON configuration (default: .cns-static-content.json)
  -h, --help                Show help

Lint options:
  --cwd <directory>         Project directory (default: current directory)
  --config <path>           Biome configuration file or directory
  --write                   Apply safe lint fixes (no formatting)
  -h, --help                Show help

Options:
  --cwd <directory>          Project directory (default: current directory)
  --entry <file>             HTML entry relative to the project (default: src/index.html)
  --out-dir <directory>      Output directory relative to the project (default: dist)
  --purge-content <path>     Additional PurgeCSS content path (repeatable)
  --purge-ignore <file>      CSS selectors to preserve (repeatable)
  --safelist <token>         Exact PurgeCSS selector token to preserve (repeatable)
  --no-clipboard             Do not copy the generated HTML
  --no-purge                Disable PurgeCSS cleanup entirely
  --no-optimize              Disable Parcel production optimization
  --public-url <url>         Parcel public URL (default: /)
  --responsive-css           Measure main height from 1600px to 320px with Playwright
  --dev                     Start a Parcel dev server with watch mode and HMR
  --watch                   Alias for --dev
  --open                    Open the dev URL in the browser
  --port <port>             Dev server port (default: 1234)
  --host <host>             Dev server host (default: 127.0.0.1)
  --verbose                 Print bundler output
  -h, --help                Show help
`;

async function main() {
  let options;
  try {
    const command = process.argv[2];
    if (['verify', 'test:unit', 'test:size', 'test:e2e', 'test:regression'].includes(command)) {
      const verifyOptions = parseVerifyArguments(process.argv.slice(3));
      if (verifyOptions.help) {
        process.stdout.write(help);
        return;
      }
      if (command === 'verify') {
        const result = await runVerify(verifyOptions);
        for (const check of result.checks) {
          const failed = check.error || check.exitCode > 0 || check.failures?.length;
          const status = check.skipped ? `SKIPPED (${check.skipped})` : failed ? 'FAILED' : check.warnings?.length ? 'WARNING' : 'passed';
          process.stdout.write(`${check.name}: ${status}${check.error ? ` (${check.error})` : ''}\n`);
          for (const warning of check.warnings ?? []) process.stderr.write(`Warning: ${warning}\n`);
          for (const failure of check.failures ?? []) process.stderr.write(`Error: ${failure}\n`);
        }
        process.exitCode = result.exitCode;
        return;
      }
      const config = await loadVerifyConfig(verifyOptions.cwd, verifyOptions.config);
      if (command === 'test:unit') {
        process.exitCode = await testUnit({ cwd: verifyOptions.cwd, config });
      } else if (command === 'test:size') {
        const result = await testSize({ cwd: verifyOptions.cwd, config });
        for (const [artifact, measurement] of Object.entries(result.measurements)) {
          process.stdout.write(`${artifact}: ${measurement.bytes} B (soft ${measurement.soft}, hard ${measurement.hard})\n`);
        }
        for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
        for (const failure of result.failures) process.stderr.write(`Error: ${failure}\n`);
        process.exitCode = result.failures.length ? 1 : 0;
      } else if (command === 'test:e2e') {
        process.exitCode = await testE2e({ cwd: verifyOptions.cwd, config });
      } else {
        const result = await testRegression({ cwd: verifyOptions.cwd, config });
        for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
        if (result.warnings.length === 0) process.stdout.write('Production/dev screenshots are within tolerance.\n');
      }
      return;
    }
    if (process.argv[2] === 'lint') {
      const lintOptions = parseLintArguments(process.argv.slice(3));
      if (lintOptions.help) {
        process.stdout.write(help);
        return;
      }
      const result = await lint(lintOptions);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
      return;
    }
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
    if (result.outputs.responsiveCss) {
      process.stdout.write(`Created ${result.outputs.responsiveCss}\n`);
      process.stdout.write(await fs.readFile(result.outputs.responsiveCss, 'utf8'));
    }
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
