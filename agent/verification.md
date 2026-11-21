# Verification and tests

At the end of a project task or session, run the CLI verification command below and check the project documentation. For documentation changes, also validate the edited documents and their links. The additional checks below apply when relevant to the changes.

## Automated checks

- At the end of a task or session, run `esmj-cns-static-content-cli verify` from the affected package directory, including for documentation-only tasks. If the installed version does not support it or the command cannot run, report verification as blocked; do not silently substitute another command or claim verification passed.
- For package code changes, first run `npm run lint:fix` from the repository root and review the diff for unrelated edits. It formats and auto-fixes package JavaScript; it does not format these Markdown documents.
- For package code changes, from the repository root run `npm run lint` and `npm test -- --runInBand`. These currently check the repository, not just the new package; distinguish pre-existing failures from regressions.
- Keep the repository lint and test checks in addition to CLI verification unless the installed CLI's verified contract explicitly replaces them. Do not assume which checks `verify` performs or invent options for it.
- The installed CLI provides Jest and owns its generated configuration; its implementation is shipped with the module under `node_modules/@esmj/cns-static-content-cli/src/verify.mjs`. Configure supported overrides through `.cns-static-content.json` rather than relying on a consumer-root `jest.config.js`. Tests use `__tests__` directories and names ending in `Spec.js` or `Spec.jsx`. Any template assertion is only a placeholder, not meaningful coverage.
- ESM import/export source requires a supported Jest transformation until the CLI runner natively executes ESM. Configure overrides through `.cns-static-content.json` and declare required Babel/Jest transformer packages as direct development dependencies.
- Playwright must be resolvable from the consumer package or a monorepo ancestor. Declare it as a direct development dependency and pin a version matching the CLI's tested version. Install Chromium separately using the matching Playwright version.
- Test the behavior introduced or changed, including relevant failure cases. Mock CMS boundaries explicitly; passing mocked tests does not establish CMS integration success.
- For package code changes, from the package directory run `npm run build -- --no-clipboard` to validate production output without replacing the user's clipboard.

## Production output

The production CLI bundles content, purges unused CSS, validates JavaScript as ES2018, and exports these artifacts under the package's default `dist` directory:

- `staticContent.html`: self-contained HTML with CSS and JavaScript embedded.
- `staticContent.css`: standalone CSS.
- `staticContent.js`: standalone JavaScript.

Ignore generated `dist/` output in version control, but confirm and inspect all three artifacts. Do not hand-edit generated output to repair source problems.

Inspect output for missing content, leaked development-only markup, broken asset references, and styles removed by CSS purging, particularly dynamically applied classes. Inspect CLI help before using options such as `--entry`, `--out-dir`, repeatable `--purge-content` and `--purge-ignore`, or `--verbose`.

## Browser and integration checks

- Run `npm run dev` from the package directory and check relevant mobile and desktop sizes and interactions.
- Development preview success alone is insufficient; check production rendering in an appropriate host too.
- Production E2E tests should inject only the CMS boundaries they need and mock API responses at the network layer. Validate live payloads and CORS separately outside those mocks.
- When checks depend on URL input, configure the local `page` path and query in `.cns-static-content.json`, for example `/?parentUrl=https%3A%2F%2Fwww.sport.cz%2Farticle`. Responsive CSS and the dev visual-regression screenshot use it; E2E tests can navigate with `page.goto(baseURL)` using Playwright's `baseURL` fixture. `page.goto('')` discards fragments and `page.goto('/')` discards the path and query. A default `/` comparison can otherwise compare two empty or invalid states.
- Prefer `regression.productionUrl` as the visual baseline: configure it with the complete published content URL to compare against the local dev preview. The check is skipped when no URL is configured; do not report the live comparison as passed.
- Compare equivalent URL input and application state, and verify that both full pages display comparable content. Report intentional or environment-dependent differences, such as fonts, CORS behavior, or host chrome, and report navigation errors explicitly; do not treat failed loading as a valid comparison.
- Inspect the saved production, development, and (when dimensions match) diff images under the printed `test-results/visual-regression-*` directory when investigating visual warnings. Keep generated screenshots under `test-results/` and ignore that directory in version control.
- Do not commit local development or production PNG snapshots by default. Commit snapshots only with explicit approval, a fixed browser and platform, and no reliable published reference.
- Separate local checks from CMS-only checks: parent-page navigation, actual tracking delivery, and iframe resizing require the real integration environment. Development mocks cannot verify them.
- If the required browser or CMS environment is unavailable, state which checks remain unverified and why.

## Definition of done

- Unique package identity; no template placeholders remain.
- `esmj-cns-static-content-cli verify` passes, or its failure or unavailability is explicitly reported.
- Meaningful tests, lint, and production build pass, or failures and their scope are explicitly reported.
- Production content, styles, assets, and responsive interactions are checked.
- Applicable CMS behavior is verified, or clearly listed as unverified with the missing environment or prerequisite.
- The project `README.md` and `TASK.md` have been checked and updated if needed, following [project documentation](project-documentation.md); unresolved documentation gaps are reported.
- Final report states what changed, which checks ran, and what remains blocked. Never claim an unperformed check passed.