# Dependency selection and size measurement

Read this before adding a library or choosing a project-local helper instead. Prefer the smallest maintainable solution that meets the actual feature requirements, not simply the fewest bytes.

## Use @esmj/size

Source: [@esmj/size documentation](https://www.npmjs.com/package/@esmj/size), reviewed 2026-11-12 (published version 0.9.1). The tool requires Node.js 20+; this repository uses Node.js 24.

`@esmj/size` bundles code with Webpack and reports minified, gzip, and Brotli sizes, estimated transfer times, and package metadata. It is an analysis tool, not a production dependency of the static-content package.

1. Inspect available options with `npx @esmj/size --help`. Use the options supported by the version being run.
2. Measure candidates separately, for example `npx @esmj/size moment` and `npx @esmj/size dayjs`. The npm package for Day.js is `dayjs`, not `day-js`.
3. Use a representative code snippet with observable output so optimization cannot remove the feature. For example:
   - `npx @esmj/size moment --bundle --code "import moment from 'moment'; console.log(moment('2026-11-12').format('DD.MM.YYYY'));"`
   - `npx @esmj/size dayjs --bundle --code "import dayjs from 'dayjs'; console.log(dayjs('2026-11-12').format('DD.MM.YYYY'));"`
4. Include the plugins, locales, and imports actually needed. Comparing a fully configured candidate with another candidate's core-only bundle is not a fair comparison.
5. Record the tool version, resolved dependency versions, snippet/options, and minified/gzip/Brotli bytes. Package versions can be specified, for example `moment@2.29.4`; this is syntax guidance, not a recommendation to use that version. Use the same tool version and measurement settings across candidates.

Useful options:

- `--json`: machine-readable results; `--pretty`: formatted object output.
- `--bundle`: include dependencies otherwise treated as external and enable tree shaking, per the tool documentation.
- `--code <string>`: measure representative usage rather than only package imports. A self-contained native/helper snippet can be measured without a package argument; make its output observable.
- `--local <dir>`: include a local package directory; repeatable. Use `--local .` from the relevant package when appropriate, not accidentally from the workspace root.
- `--explain`: module breakdown; `--analyze`: interactive analysis requiring a TTY.
- `--full`: disables tree-shaking and side-effect optimizations for a diagnostic comparison. Do not mix this result with an optimized candidate and call it a fair comparison.

A comma-separated argument such as `moment,dayjs` measures them together, not as alternatives. Download-time values are estimates, not measured browser performance. npm unpacked size is not the shipped JavaScript size. Do not mark a production dependency external merely to make the reported size smaller.

## Choose a library, native API, or local helper

For each candidate, compare feature coverage, shipped bytes, browser support, implementation complexity, edge cases, tests, and ongoing maintenance.

- Prefer a native API such as `Intl.DateTimeFormat` for supported locale formatting when it satisfies the required behavior. Check the configured browsers and input/time-zone semantics.
- Prefer a small helper in the concrete package for a narrow, clearly specified operation that is simple to implement and test. Keep it package-local unless reuse justifies a separate shared abstraction.
- Prefer a small maintained library such as Day.js when the requirement includes enough parsing, arithmetic, locale, or time-zone behavior that a custom helper would become complex or error-prone. Include necessary plugins/locales in the size comparison.
- Moment is a larger candidate, not an automatic default. Select it only if required compatibility or functionality justifies its measured cost. Do not invent exact savings or blindly replace an existing dependency.
- Do not reimplement a general date/time library to save bytes. Test invalid inputs, time zones, daylight-saving transitions, and locale behavior whenever relevant to the feature.

Report the choice briefly: requirement, measured alternatives, helper complexity and test burden, selected approach, and trade-off. If measurement cannot run, report that limitation rather than presenting estimates as results.

Finally, compare the affected package's production build with and without the chosen implementation where practical. The project's Parcel/CLI output may differ from the Webpack measurement because of imports, tree shaking, shared dependencies, and inlining. A smaller package-level estimate is not proof of a smaller final artifact.