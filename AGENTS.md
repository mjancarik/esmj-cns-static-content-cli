# Project essentials

- Node.js 18+, JavaScript ES modules (`.mjs`).
- CLI entry: `src/cli.mjs`; build logic: `src/build.mjs`.
- Keep builds independent of the CLI's working directory. Never modify the consuming project's configuration.
- Browser targets belong in `src/browser-targets.mjs` and are applied explicitly by `src/parcel-build.mjs`, not inherited from the consuming project.
- Preserve ES2018 output validation and HTML/CSS/JS artifact consistency.
- Use Biome for linting and Node's built-in test runner. Run `npm run lint` and `npm test` after code changes.
- Keep integration tests using real Parcel builds in temporary directories; stub clipboard access.