# Contribution and coding conventions

## Required

- Use native JavaScript. Format and auto-fix code with `npm run lint:fix` from the repository root, using the project's ESLint/Prettier configuration. This command targets package JavaScript, not Markdown, HTML, or stylesheet files. Review its diff and do not include unrelated formatting changes.
- Initialize JavaScript after HTML loading, using `DOMContentLoaded` or window `load`.
- Use mobile-first styles. Both media queries and container queries are allowed; choose based on whether the layout depends on the viewport or its container. Preserve a usable fallback for configured browsers without container-query support.
- Use `rem` for sizes, except for cases such as borders and horizontal rules.
- Load fonts from the Seznam CDN, not Google Fonts, and include only the weights used by the content.
- Seznam CDN asset URLs can use different hosts, for example `https://d39-a.sdn.cz` or `https://d94-a.sdn.cz`. Do not hardcode `d39-a` as the only allowed host or replace a supplied asset's host with another shard; use the actual published asset URL.
- Add comments where they explain non-obvious behavior and make code easier to reuse.
- Keep changes scoped to the requested package; avoid unrelated formatting or shared-helper changes.
- Follow the HTML, link, tracking, and iframe requirements in [CMS integration](cms.md).

## Preferred

- Prefer container queries when responsiveness depends on the container rather than the viewport.
- Minimize external dependencies. Prefer NPM imports for libraries; use Seznam CDN hosting when appropriate.
- Before selecting a library, use `@esmj/size` to compare candidates and weigh their bundle cost against the implementation and maintenance complexity of a project-local helper. Follow [dependency selection](dependencies.md); do not choose on package size alone.
- Prefer local JSON data over runtime API requests. Local JSON can be loaded with `require`, for example `const data = require('./data.json');`.

## Conditional

- CSS, Less, or Sass may be used.
- For CNS content, use the selected site's `api-web` API and read [CNS API integration](cns-api.md) before implementation. For external-data proxy requests such as Google Sheets, use `api-external` and verify the proxy contract separately; it is outside the CNS API guide's scope.
- Do not add IE11 support based on historical library compatibility notes. Follow the project's configured browser requirements.

Consult the team's current coding guidelines through the approved internal source when relevant. If they are unavailable, report that limitation; do not invent additional rules.