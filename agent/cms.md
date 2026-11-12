# CMS integration and known limitations

## HTML and links

- Use `h2` as the highest-level heading, not `h1`.
- Apply `content-wrapper` to basic content elements such as headings, paragraphs, and links. Define shared background, padding, and font styles in the CSS for that class.
- Set `cursor: pointer` on clickable elements and links.
- Set links to `target="_top"` or `target="_blank"` so destinations do not open inside the iframe, and add `rel="noopener"`.
- For static HTML links, call `window.$redirectAllLinks()` after the HTML loads.
- For links generated in JavaScript, use `$redirect` with link elements or `$redirectToUrl` for URL navigation. `$redirectAllLinks` does not handle these links.

## Click tracking

- Track clicks using `data-dot`.
- Add a `data-dot` value to the parent container so aggregate statistics can be filtered in Reportér. Prefix it with `sc-`, for example `sc-newsletter-banner`.
- `propagateHits` is disabled by default. When enabled on the iframe's DOT instance, it forwards hits other than `impress` and `load` to the top window's DOT instance, which may send them to the server again. Account for duplicate reporting before enabling it.

## Iframe sizing

- Use `$resizeStaticContent` when content loads dynamically or changes size and the iframe needs to grow.
- Avoid reducing iframe height: this can interfere with dynamically loaded desktop sidebar ads.
- Retain heights for individual widths to limit layout shifts (CLS).

## Runtime helpers and development mocks

- Verify which globals the CMS supplies and which development mocks exist before using a helper. A consumer repository may keep shared helpers or preview mocks in its own `share/` directory; treat these as project-owned and not as production CMS behavior.
- Do not hide integration failures behind no-op production fallbacks. Mocked navigation, tracking, and resizing do not establish CMS integration success.
- Use only helpers required by the feature. Available documented utilities include:
  - `$staticContentConfig`: static-content configuration, including disabling defaults.
  - `$Debug`: enables debug mode.
  - `$UrlParams`: URL parameters.
  - `$parentParsedUrl`: parent-page URL helper; `$parentUrlParams`: parent-page URL parameters.
  - `scriptLoader`: external-script loader instance.
- These descriptions do not establish full signatures or initialization order. Verify the contract before introducing new usage.

## Known limitations

- Image size parameters and CMS `__CLASS__` behavior are undocumented. If a feature depends on either, obtain the missing contract before implementing that part; do not guess.
- `$setFullscreenMode` is no longer used. Do not introduce it for new content without an explicit requirement.