# Package creation

This workflow describes this repository's layout and template, not a CLI scaffolding feature.

1. In the consumer repository, check whether `packages/template` exists and use it as the starting point when present. The installed CLI module does not provide this template; if the directory is absent, follow the consumer repository's established package structure instead.
2. Obtain the package name from the user before creating the package. If the request does not specify a name, ask for it; do not invent one or default to the template's name. Validate that the supplied name is valid for npm and unique in the workspace; if not, ask the user for a different name.
3. Create a new directory under `packages` using the available template or the consumer repository's established package structure. Set its package name to the user-supplied name. The template's name may vary; it does not determine the new package's identity. Set appropriate metadata and remove sample markup, console logging, and placeholder tests. Do not copy installed dependencies, build output, or caches.
4. Preserve package scripts for development (`esmj-cns-static-content-cli --dev`) and production (`esmj-cns-static-content-cli`). Inspect the template before reusing its remaining configuration.
5. Keep production markup inside `<main>` and development-only markup outside it. Preserve the template's module entry and stylesheet import pattern.
6. If the consumer repository has a `share/` directory or maps `@/*` to `share/*`, treat it as consumer-owned code. Use it for helpers or logic genuinely shared across static-content packages; do not assume the CLI provides that directory or a project-specific `@/staticContent` module. Development mocks are not production CMS behavior.
7. Initialize behavior after `DOMContentLoaded` or window `load`, and integrate only the CMS helpers the feature needs. Follow [CMS integration](cms.md).
8. Run `npm install` from the repository root to register the workspace and its dependencies.
9. Add tests for the implemented behavior and complete [verification](verification.md).