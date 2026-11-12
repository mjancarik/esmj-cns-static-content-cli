# @esmj/cns-static-content-cli

Build a Parcel HTML entry into a static, portable export without making the consuming app define its own browser or build config.

## Requirements

- Node.js 24+

## Installation

```bash
npm install @esmj/cns-static-content-cli
```

## CLI usage

Run from the app or site you want to build:

```bash
npx @esmj/cns-static-content-cli
```

Or after installing locally:

```bash
esmj-cns-static-content-cli
```

Default values:

- project directory: current working directory
- entry: `src/index.html`
- output directory: `dist`
- PurgeCSS content: all `src/**/*.html` and `src/**/*.js` files in the project
- PurgeCSS ignore file: `src/purgeignore.css`
- PurgeCSS enabled: on by default, can be disabled with `--no-purge`

### Supported options

```text
Usage: esmj-cns-static-content-cli [options]

Options:
  --cwd <directory>          Project directory (default: current directory)
  --entry <file>            HTML entry relative to the project (default: src/index.html)
  --out-dir <directory>     Output directory relative to the project (default: dist)
  --purge-content <path>    Additional PurgeCSS content path (repeatable)
  --purge-ignore <file>     CSS selectors to preserve (repeatable)
  --safelist <token>        Exact PurgeCSS selector token to preserve (repeatable)
  --no-clipboard            Do not copy the generated HTML to the clipboard
  --no-purge                Disable PurgeCSS cleanup entirely
  --no-optimize             Disable Parcel production optimization
  --public-url <url>        Parcel public URL (default: /)
  --responsive-css          Measure main height from 1600px to 320px with Playwright
  --dev                    Start a Parcel dev server with watch mode and HMR
  --watch                  Alias for --dev
  --open                   Open the dev URL in the browser
  --port <port>            Dev server port (default: 1234)
  --host <host>            Dev server host (default: 127.0.0.1)
  --verbose                Print bundler output
  -h, --help               Show help
```

Each `--safelist` value follows PurgeCSS CLI semantics and matches one exact
class/selector token (without a leading dot). For example,
`--safelist leaflet-` preserves the class `.leaflet-`; it does **not** preserve
`.leaflet-container` or every selector with a `leaflet-` prefix. Regex and prefix
matching are not supported by this option. Verify legacy output before migrating
prefix-like safelist values.

### Examples

Static export:

```bash
npx @esmj/cns-static-content-cli --cwd ./packages/site --entry src/landing.html --out-dir build --no-clipboard
```

Dev preview with browser auto-open:

```bash
npx @esmj/cns-static-content-cli --cwd ./packages/site --dev --open --host 0.0.0.0 --port 1234
```

If the consuming project's `package.json` already has a `dev` script that runs
the CLI, either add the option to that script:

```json
{
  "scripts": {
    "dev": "esmj-cns-static-content-cli --dev --open"
  }
}
```

Or leave the script as-is and run `npm run dev -- --open`. In both cases, Parcel
opens the current project's dev URL in the default browser.

## What it produces

The build writes three files into the target output directory:

- `staticContent.html` — self-contained HTML with embedded CSS and JavaScript
- `staticContent.css` — standalone CSS
- `staticContent.js` — standalone JavaScript

When building in normal mode, the generated HTML is also copied to the clipboard by default. If clipboard access is unavailable, the files still build successfully and a warning is reported.

The extracted output preserves the meaningful page content from a Parcel build:

- if the generated page contains a `<main>`, it exports that content
- otherwise it falls back to the page `<body>`

## Expected project shape

The consumer project should look like a normal Parcel app, for example:

```text
src/
  index.html
  index.js
  index.css
```

The tool expects a valid HTML entry that Parcel can build and then extracts the useful production markup from the result.

## JavaScript API

```js
import { build } from '@esmj/cns-static-content-cli';

await build({
  cwd: process.cwd(),
  entry: 'src/index.html',
  outDir: 'dist',
  purge: true,
  purgeContent: ['src/**/*.html', 'src/**/*.js'],
  purgeIgnore: ['src/purgeignore.css'],
  purgeSafelist: [],
  optimize: true,
  publicUrl: '/',
  clipboard: true,
  verbose: false,
});
```

The package also exports `parseArguments` and `serve` for advanced use.

### Mock the static-content browser API

Import the mock entry point from a consumer project's source code during
development to provide the static-content host API without requiring the host
environment:

```js
import '@esmj/cns-static-content-cli/mock';
```

Outside production builds, this installs `$resizeStaticContent`,
`$redirectAllLinks`, `$redirect`, `$redirectToUrl`, `DOT.hit`, and
`scriptLoader.load` on `window`. Redirect and analytics calls are logged;
resize and link-redirection calls are no-ops. In production, the module has no
effect. In Node.js environments without `window`, it also safely does nothing.

### Generate responsive height rules

Add `--responsive-css` to a production build to run a post-build browser pass.
It serves the generated `staticContent.html`, launches headless Chromium through
the consuming project's `playwright` or `@playwright/test` installation, and
measures the `main` element from 1600px down to 320px in 4px steps. Heights are
rounded to the nearest 0.25rem. The first sampled width where the measured height
changes becomes a `max-width` breakpoint. If an `amp-iframe` inside `main` is
visible at that width, its selector is grouped with the class placeholder.

The generated rules are written to `dist/__CLASS__.css` (or the configured
output directory) and printed to the terminal after the standard build output.
`__CLASS__` is intentionally literal for the consuming application to replace.
This feature is opt-in and requires the project to have Playwright and its
Chromium browser installed; normal builds do not need Playwright.

```bash
esmj-cns-static-content-cli --responsive-css
```

The JavaScript build API also accepts `responsiveCss: true` or an options object:

```js
await build({
  responsiveCss: {
    selector: 'main',
    minWidth: 320,
    maxWidth: 1600,
    step: 4,
    viewportHeight: 900,
    roundToRem: 0.25,
    includeAmpIframe: true,
    waitForSelector: '#content-ready',
    waitMs: 100,
  },
});
```

Use the step setting to trade profiling time for breakpoint precision. Breakpoint
widths are the first sampled widths at which the rounded content height changes.

## Verify a project

`esmj-cns-static-content-cli verify` runs all four checks and prints a summary:

1. `test:unit` runs Jest with the CLI-owned config (the supplied
   `modulePaths`, `testRegex`, asset/style mocks, and `@/` alias).
2. The production static-content build is performed once.
3. `test:size` measures raw output bytes. Defaults are HTML 100/150 KiB,
   CSS 50/80 KiB, and JS 200/300 KiB (soft/hard). Exceeding soft warns;
   exceeding hard fails verification.
4. `test:e2e` serves the generated `staticContent.html` at `/` and runs the
   project's Playwright tests.
5. `test:regression` serves Parcel's production page and starts a dev server,
   then compares browser screenshots. Differences above the default 0.1% pixel
   ratio warn for manual review and do not fail verification.

The checks are also available individually as `test:unit`, `test:size`,
`test:e2e`, and `test:regression`. Size, E2E, and regression commands build when
run alone. `verify` shares its production build among those checks. Unit and
Playwright checks use the versions installed by the project or a monorepo
ancestor; Playwright's browser must already be installed. E2E tests should be in
`e2e/` by default and can navigate with `page.goto('/')` using Playwright's
configured `baseURL`.

Verification uses `.cns-static-content.json` at the project root. Every setting
is optional; the defaults above apply. Individual checks can override their
configuration, and the file is never rewritten. For example:

```json
{
  "sizeLimits": {
    "html": { "soft": 102400, "hard": 153600 },
    "css": { "soft": 51200, "hard": 81920 },
    "js": { "soft": 204800, "hard": 307200 }
  },
  "build": { "entry": "src/index.html", "outDir": "dist" },
  "unit": { "testEnvironment": "jsdom" },
  "e2e": {
    "testDir": "e2e",
    "testMatch": "**/*.spec.{js,jsx,ts,tsx}",
    "playwright": { "workers": 2 }
  },
  "regression": {
    "viewport": { "width": 1280, "height": 720 },
    "maxDiffPixelRatio": 0.001,
    "pixelThreshold": 0.1,
    "waitForSelector": "main",
    "waitMs": 100
  }
}
```

Run all checks from a package or monorepo root with `verify --cwd <path>`;
select another config using `--config <path>`. The JavaScript API exports
`runVerify`, `testUnit`, `testSize`, `testE2e`, and `testRegression` from
`@esmj/cns-static-content-cli/verify`.

## Lint source files

Run `esmj-cns-static-content-cli lint` to lint the project's source directory
with the bundled Biome dependency. No HTML entry, Parcel build, clipboard access,
or consumer configuration changes are involved.

- `lint [paths...]` accepts files or directories relative to the project; default: `src`.
- `--cwd <directory>` selects the project directory.
- `--config <path>` explicitly selects a Biome config file or directory, relative to the project.
- `--write` applies safe lint fixes. It does not run the formatter or unsafe fixes.
- `--help` displays help. Biome diagnostics and exit status are returned by the CLI.

Configuration selection: an explicit `--config` wins; otherwise an existing
project or ancestor Biome config is discovered using Biome's native resolution.
If none exists, the bundled [preset](src/biome-preset.json) is used. Existing
configs are not silently merged or rewritten, and invalid configs fail rather
than falling back. The shell's `BIOME_CONFIG_PATH` does not override this selection.

### Extend the baseline in a monorepo

Install this CLI at the monorepo root. In the root Biome configuration, set
`extends` to `["@esmj/cns-static-content-cli/biome.json"]` and add the monorepo's
own settings, rules, globals, and file overrides. This exported preset is included
in the published package. Lint commands run from child packages discover the root
config automatically. For per-package overrides, use Biome's nested configuration
with `"root": false` and `"extends": ["//"]` to inherit the monorepo root.

The JavaScript API is available through `@esmj/cns-static-content-cli/lint`:
`lint({ cwd, paths: ['src'], config, write: false })` returns
`{ exitCode, stdout, stderr }`. `parseLintArguments` is exported from the same module.

### ESLint and Prettier migration notes

The baseline enables Biome's recommended rules, rejects undeclared variables,
and prohibits console calls except `console.warn` and `console.error`.
Browser globals and `globalThis` are recognized by Biome; common Jasmine and
Jest globals are declared in the preset.

Formatter settings preserve the requested single JavaScript and JSX quotes and
`bracketSameLine: false`, with two-space indentation. They take effect only when
running Biome's formatter/check command with this configuration: **`lint` does
not check formatting**, unlike the old `prettier/prettier` ESLint rule.

Biome's recommended rules are not an exact copy of `eslint:recommended`, it does
not load ESLint plugins or enforce an ECMAScript 2020 parser ceiling, and its
globals setting does not reproduce ESLint's read-only custom-global flags.
ES2018 validation of production build output remains separate and unchanged.

## Notes

- The CLI owns the browser targets used during the Parcel build, so the consuming app does not need a project-level `browserslist` configuration for this tool.
- Exported HTML and CSS are intentionally self-contained: local images and other media are inlined as `data:` URLs so the final static content keeps working outside its original `dist` folder.
- JavaScript is validated against ES2018 with `es-check` before the final export is accepted.
- Remote scripts are not embedded into the generated static JS; only the local Parcel output and inline built scripts are exported.
