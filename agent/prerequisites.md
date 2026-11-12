# Prerequisites

- Use Node.js 24 and run `npm install` from the repository root. After adding or changing workspace dependencies, run it again from the root.
- Packages are npm workspaces under `packages/*`, configured in [package.json](../package.json).
- Use the installed `@esmj/cns-static-content-cli` through package scripts. From a package directory, use `npm run build -- --help` to inspect supported options rather than assuming flags or features.
- Node.js 24 is the development runtime, not the browser target. Production JavaScript must pass ES2018 validation; preserve the project's browser compatibility requirements.
- Lint and test commands currently belong to this repository, not the CLI. See [verification](verification.md) for commands and working directories.