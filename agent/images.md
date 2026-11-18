# CMS and Seznam CDN images

Use this guidance when generating or modifying Seznam CDN image URLs, including images obtained from the CNS API. Inspect the selected site's schema and live response to identify the actual media, URL, type, and trim fields; do not assume every API resource has the same shape. Follow [CNS API integration](cns-api.md) for request and response validation.

## Identify Seznam CDN images

These rules apply only to URLs whose hostname is a subdomain of `sdn.cz`, such as `image.sdn.cz`. Check the parsed hostname, not a substring of the URL; `sdn.cz` itself and unrelated hosts such as `sdn.cz.example.com` are not subdomains of `sdn.cz`. Images on other domains are not Seznam CDN images: leave their URLs unchanged by this guideline, and do not apply its filters, format, encoding, or responsive-image rules to them. An image coming from the CNS API does not by itself establish that its URL belongs to the Seznam CDN.

## URL rules

- Generate JPEG only. Do not request, negotiate, or fall back to WebP or AVIF; never emit `.webp`, `.avif`, `|webp,...`, or `|avif,...`.
- Leave a missing source, a data URI, or a source already containing a query string unchanged. Do not add filters or encode a replacement URL for those cases.
- With concrete trim coordinates, append the following operations in exactly this order:

  ```text
  {source}?fl=crop,{trimX},{trimY},{trimWidth},{trimHeight}|res,{width},1|blr,{blurRadius},{gaussianBlurRadius}|jpg,{compression},,1
  ```

  Crop and resize are required; blur is optional and must be omitted entirely when not requested. JPEG encoding is mandatory. The default compression is `80`, `keep_outer_bound` is `1`, and the default Gaussian blur radius is `Math.floor(Math.sqrt(blurRadius))`.
- When trim width or height coordinates are unavailable, use smart crop instead:

  ```text
  {source}?fl=crs,600,337,7
  ```

  This is the final transformation URL: do not append `crop`, `res`, `blr`, or `jpg`. Set client-side width to the requested width and height to `Math.floor((requestedWidth / 16) * 9)`. Since this expression has no explicit JPEG operation, verify that the CDN actually returns JPEG for the integration; do not add a different format or silently claim it was verified.
- For transformed URLs, apply `encodeURI` to the complete resulting CDN URL before using it as `src` or in `srcset`, except in Storybook. Do not use `encodeURIComponent`.

## Trim selection

These trim keys are immutable API values; use them exactly:

| Logical name | Trim key | Meaning |
| --- | --- | --- |
| `ORIGINAL` | `original` | Original aspect ratio; fallback trim |
| `CRT4x3` | `crt_4x3` | 4:3 crop |
| `DEFAULT16x9` | `default_16x9` | Default 16:9 crop |
| `SQUARE1x1` | `square_1x1` | Square 1:1 crop |
| `WIDE3x2` | `wide_3x2` | Wide 3:2 crop |

- If trims exist for the requested image `type`, use that trim set; otherwise fall back to `media.trims.original`.
- For video media, use `media.caption.url` and `media.caption.trims` instead.
- If no trim set is available, use smart crop. Round trim-derived output dimensions down with `Math.floor`.

## Widths and responsive images

When a named width is needed, use these immutable values without inventing or renaming constants:

| Constant | Pixels | Constant | Pixels |
| --- | ---: | --- | ---: |
| `WIDTH60` | 60 | `WIDTH80` | 80 |
| `WIDTH160` | 160 | `WIDTH240` | 240 |
| `WIDTH320` | 320 | `WIDTH480` | 480 |
| `WIDTH600` | 600 | `WIDTH640` | 640 |
| `WIDTH722` | 722 | `WIDTH1024` | 1024 |
| `WIDTH1200` | 1200 | `WIDTH1280` | 1280 |
| `WIDTH2560` | 2560 | | |

- The standard general-purpose responsive widths, in order, are `320, 480, 600, 722, 1024, 1280, 2560`; the default fallback size is `1200`.
- A canonical wide layout uses `1000px` as its `sizes` value, other layouts use `700px`, and below an `851px` viewport the source size is `100vw`.
- Generate every `srcset` candidate through the same URL rules above. Use `{actualWidth}w` descriptors, with:

  ```js
  const actualWidth = trimWidth && trimWidth <= requestedWidth
    ? trimWidth
    : requestedWidth;
  ```

- Do not emit duplicate candidates with the same actual width. Emit `sizes` only from supplied size entries and preserve their source order.
