# CNS API integration

Read this before implementing CNS content requests through `api-web`. This is agent-facing guidance; no user-facing repository documentation is required.

## Sources and access

Reviewed on 2026-11-12:

- [CNS API operations](https://doc.cns.dev.dszn.cz/docs/cns/external-and-web-api-operations): embedding, projection, filtering, ordering, and pagination for the web API.
- [Seznam Zprávy API documentation](https://api-web.seznamzpravy.cz/) and [OpenAPI specification](https://api-web.seznamzpravy.cz/openapi.json).
- [Sport API documentation](https://api-web.sport.cz/) and [OpenAPI specification](https://api-web.sport.cz/openapi.json).

Treat these as internal documentation even when reachable from the current environment. All seven site specifications below were reachable and identified themselves as OpenAPI 3.1.0 during this review. This does not establish public access, browser CORS permission, or authorization for every endpoint. If access later fails, report it and obtain access through the normal workflow; do not bypass authentication or ask for secrets in chat.

## Select the site and API

| Target site | API base and interactive documentation | Specification |
| --- | --- | --- |
| www.seznamzpravy.cz | https://api-web.seznamzpravy.cz | [OpenAPI](https://api-web.seznamzpravy.cz/openapi.json) |
| sport.cz | https://api-web.sport.cz | [OpenAPI](https://api-web.sport.cz/openapi.json) |
| novinky.cz | https://api-web.novinky.cz | [OpenAPI](https://api-web.novinky.cz/openapi.json) |
| super.cz | https://api-web.super.cz | [OpenAPI](https://api-web.super.cz/openapi.json) |
| medium.seznam.cz | https://api-web.medium.seznam.cz | [OpenAPI](https://api-web.medium.seznam.cz/openapi.json) |
| prozeny.cz | https://api-web.prozeny.cz | [OpenAPI](https://api-web.prozeny.cz/openapi.json) |
| garaz.cz | https://api-web.garaz.cz | [OpenAPI](https://api-web.garaz.cz/openapi.json) |

- Choose the target site explicitly from the task. Ask if it is unclear; do not query another site's API as a fallback.
- Use `api-web` for CNS content. It is not generally obsolete.
- Do not embed private credentials or preview tokens in public static-content output. Verify the approved credential model before using an endpoint that needs them.

## Discover the resource before coding

Read the selected site's current OpenAPI operation and response schema. The following GET collection paths exist in all seven inspected specifications:

- `/v1/documents`: documents.
- `/v1/documents/articles`: articles (not `/v1/articles`).
- `/v1/authors`: authors.
- `/v1/sections`: sections.
- `/v1/tags`: tags.

The Seznam Zprávy and Sport specifications also expose `/v1/media/images`, `/v1/staticcontents`, and corresponding item routes. For articles, `/v1/documents/articles/{item_id}` returns an `ArticlePublished` object, while the collection returns `ArticlePublishedListing`.

Do not assume site schemas are identical: for example, the inspected Sport article schema includes `scoreTitle` and `game`, which were absent from the inspected Seznam Zprávy article schema. Verify fields, identifier types, embedded relations, and error responses on the selected site. `_id` and `uid` are different identifiers; do not interchange them without checking the operation's contract.

## Query parameters

Construct URLs with `URL` and `URLSearchParams`. Serialize filters with `JSON.stringify`; do not concatenate unescaped JSON or use JavaScript single-quoted object syntax as JSON.

| Parameter | Meaning and example |
| --- | --- |
| `embedded` | Comma-separated reference fields to resolve, e.g. `authors,sections`. References become objects rather than IDs. Resolve only what is needed. |
| `projection` | Return selected fields, e.g. `uid,title,perex,dateOfPublication`. Nested fields use dots; brackets can group prefixes, e.g. `authors.(name,uid)`. |
| `filter` | JSON query object, e.g. `{"uid":{"$in":[123,456]}}`. IDs here are placeholders, not actual article references. |
| `order` | Comma-separated sort fields; `-` means descending, e.g. `-dateOfPublication,-uid`. Specify ordering when the UI depends on it. |
| `limit` | Positive page size. The inspected article collections default to 18; the maximum is resource-configured. |
| `offset` | Number of items to skip, not a page number; start at 0. |

### Filtering rules

- Equality can use a direct value or `$eq`. Supported documented comparisons include `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, and `$nin`; logical operators include `$and`, `$or`, and `$not`. Verify support for the selected resource rather than assuming every MongoDB operator is available.
- Filter references by their IDs, e.g. `{"authors":{"$in":["AUTHOR_OBJECT_ID"]}}`. Adding `embedded=authors` does not allow filtering on `authors.name` across that reference.
- A numeric range can use `{"uid":{"$gt":0,"$lte":100}}`. For date ranges, first verify the field's format and timezone contract; do not infer date semantics from example strings.
- `$find` is a restricted pseudo-regex search, not arbitrary regular expressions. The operations guide documents `^`/`$` string boundaries and `~` word boundaries.
- The inspected article operations document `searchString` and `advancedSearchString: 1` inside the filter for full-text/substring searching. Confirm behavior on the target resource before relying on it.
- Allowlist user-facing filter fields and operators; do not forward arbitrary user-supplied Mongo queries.

### Projection and embedding cautions

- The inspected OpenAPI descriptions permit exclusion with `-`, e.g. `-content`. Do not mix included and excluded fields, except for the documented `-_id` exception.
- Omitted fields are absent, not necessarily `null`. Handle both absent and nullable fields when rendering.
- `WEB_PROTECTED_FIELDS` must not be returned even if explicitly projected. A property listed in a broad generated schema does not guarantee that the web API exposes it.
- Embedding resolves references before projection. A projection only on an embedded field may leave other top-level fields intact; the operations guide explicitly shows this for `sections.name`. Verify the response rather than assuming this limits the entire payload.

### Pagination and responses

- Article collection responses use `_items` and `_meta`; item routes return an object directly. The inspected schemas allow missing or nullable collection members, so validate the response before use.
- Metadata includes `count`, `limit`, `offset`, `nextItems`, and `previousItems`. Do not treat `_items.length` as the total count.
- Use a small explicit limit, bounded pagination, and a stable ordering. Advance by the effective page size, stop when `nextItems` is false or the returned list is empty, and guard against non-advancing offsets. Do not load an entire archive for a small widget.
- The general operations guide mentions a default maximum of 1000 unless overridden; current OpenAPI describes a resource-specific `MAX_LIMIT`. Do not hardcode 1000 as universally supported.

## Example request construction

This example constructs a read-only article listing request using parameters documented for Seznam Zprávy; it was not executed against live content during this review:

```javascript
const url = new URL('/v1/documents/articles', 'https://api-web.seznamzpravy.cz');
url.search = new URLSearchParams({
  projection: 'uid,title,perex,dateOfPublication',
  order: '-dateOfPublication,-uid',
  limit: '10',
  offset: '0',
}).toString();
```

For filtering, add `url.searchParams.set('filter', JSON.stringify(filter))` with a validated filter object. Do not insert placeholder IDs into a production request.

## Implementation and verification

- Prefer local data if freshness does not require runtime requests. Request only the fields and records the feature needs.
- Use read-only, documented content operations for research. Do not invoke write, voting, subscription, preview-token, or account operations just to test connectivity; even GET is not proof that an endpoint has no side effects.
- Verify CORS in the actual preview/CMS origin. Successful server-side fetches do not prove browser access. Do not use `mode: 'no-cors'` as a workaround for unreadable responses.
- Check HTTP status before parsing success data; handle network failure, malformed responses, missing fields, and empty results. The inspected article operations document 400, 404, and 422 responses. Do not retry invalid queries indefinitely.
- Use the native `fetch` API unless the consumer project already has a suitable shared request helper. Check `response.ok` before parsing success data and handle HTTP errors explicitly; do not assume a project-local helper has correct error handling without inspecting it.
- Use bounded timeouts/cancellation compatible with the project's browser targets, plus loading, empty, and error UI states. Render text safely; do not insert API-provided HTML without an approved rendering/sanitization contract.
- Test query encoding, projection-dependent missing fields, empty results, pagination, and failed requests with fixtures. Validate real CMS integration separately and report unperformed checks.

## Documentation conflicts and limits

- The general guide lists `$eg` but demonstrates `$eq`; use `$eq`, not the typo.
- Its pagination example requests `offset=10` but shows metadata offset 0. Treat that example as inconsistent; check the real response.
- The guide says `_id` is always implicitly returned and ordering defaults to `_id`; current inspected OpenAPI documents a `-_id` projection exception and resource-specific default ordering. These differences are unresolved runtime details, not grounds to assume one global behavior. Keep `_id` by default, specify required ordering, and verify any exception before use.
- This review read documentation/specifications only. It did not establish runtime authentication, CORS, rate limits, cache policy, or publication/preview access rules, and did not query live article data. Verify those for the concrete project rather than inventing defaults.