# Verification and tests

These checks apply to package creation and behavior changes. For documentation-only changes, validate the edited documents and their links; application tests and builds are not required.

## Automated checks

- From the package directory, run `esmj-cns-static-content-cli verify` as the package verification command. This command is provided by the CLI maintainer and may not yet be available in the public release. If the installed version does not support it, report the version limitation and verification as blocked; do not silently substitute another command or claim verification passed.
- For package code changes, first run `npm run lint:fix` from the repository root and review the diff for unrelated edits. It formats and auto-fixes package JavaScript; it does not format these Markdown documents.
- From the repository root, run `npm run lint` and `npm test -- --runInBand`. These currently check the repository, not just the new package; distinguish pre-existing failures from regressions.
- Keep the repository lint and test checks in addition to CLI verification unless the installed CLI's verified contract explicitly replaces them. Do not assume which checks `verify` performs or invent options for it.
- The installed CLI provides Jest and owns its generated configuration; its implementation is shipped with the module under `node_modules/@esmj/cns-static-content-cli/src/verify.mjs`. Configure supported overrides through `.cns-static-content.json` rather than relying on a consumer-root `jest.config.js`. Tests use `__tests__` directories and names ending in `Spec.js` or `Spec.jsx`. Any template assertion is only a placeholder, not meaningful coverage.
- Test the behavior introduced or changed, including relevant failure cases. Mock CMS boundaries explicitly; passing mocked tests does not establish CMS integration success.
- From the package directory, run `npm run build -- --no-clipboard` to validate production output without replacing the user's clipboard.

## Production output

The production CLI bundles content, purges unused CSS, validates JavaScript as ES2018, and exports these artifacts under the package's default `dist` directory:

- `staticContent.html`: self-contained HTML with CSS and JavaScript embedded.
- `staticContent.css`: standalone CSS.
- `staticContent.js`: standalone JavaScript.

Confirm all three artifacts exist. Do not hand-edit generated output to repair source problems.

Inspect output for missing content, leaked development-only markup, broken asset references, and styles removed by CSS purging, particularly dynamically applied classes. Inspect CLI help before using options such as `--entry`, `--out-dir`, repeatable `--purge-content` and `--purge-ignore`, or `--verbose`.

## Browser and integration checks

- Run `npm run dev` from the package directory and check relevant mobile and desktop sizes and interactions.
- Development preview success alone is insufficient; check production rendering in an appropriate host too.
- Separate local checks from CMS-only checks: parent-page navigation, actual tracking delivery, and iframe resizing require the real integration environment. Development mocks cannot verify them.
- If the required browser or CMS environment is unavailable, state which checks remain unverified and why.

## Definition of done

- Unique package identity; no template placeholders remain.
- `esmj-cns-static-content-cli verify` passes, or its failure or unavailability is explicitly reported.
- Meaningful tests, lint, and production build pass, or failures and their scope are explicitly reported.
- Production content, styles, assets, and responsive interactions are checked.
- Applicable CMS behavior is verified, or clearly listed as unverified with the missing environment or prerequisite.
- Final report states what changed, which checks ran, and what remains blocked. Never claim an unperformed check passed.