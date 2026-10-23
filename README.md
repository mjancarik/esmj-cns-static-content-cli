# @esmj/cns-static-content-cli

Build a Parcel HTML entry into a static, portable export without making the consuming app define its own browser or build config.

## Requirements

- Node.js 18+

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
  --no-clipboard            Do not copy the generated HTML to the clipboard
  --no-purge                Disable PurgeCSS cleanup entirely
  --dev                    Start a Parcel dev server with watch mode and HMR
  --watch                  Alias for --dev
  --open                   Open the generated URL in the browser
  --port <port>            Dev server port (default: 1234)
  --host <host>            Dev server host (default: 127.0.0.1)
  --verbose                Print bundler output
  -h, --help               Show help
```

### Examples

Static export:

```bash
npx @esmj/cns-static-content-cli --cwd ./packages/site --entry src/landing.html --out-dir build --no-clipboard
```

Dev preview with browser auto-open:

```bash
npx @esmj/cns-static-content-cli --cwd ./packages/site --dev --open --host 0.0.0.0 --port 1234
```

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
  clipboard: true,
  verbose: false,
});
```

The package also exports `parseArguments` and `serve` for advanced use.

## Notes

- The CLI owns the browser targets used during the Parcel build, so the consuming app does not need a project-level `browserslist` configuration for this tool.
- Exported HTML and CSS are intentionally self-contained: local images and other media are inlined as `data:` URLs so the final static content keeps working outside its original `dist` folder.
- JavaScript is validated against ES2018 with `es-check` before the final export is accepted.
- Remote scripts are not embedded into the generated static JS; only the local Parcel output and inline built scripts are exported.
