# Agent instructions

This directory is the canonical shared instruction source shipped by `@esmj/cns-static-content-cli` for creating and maintaining static-content packages.

## Required instruction loading

Before creating or modifying a package, read all five instruction documents below. Markdown links are not automatic imports; open and read the files explicitly.

1. [Prerequisites](prerequisites.md)
2. [Package creation](package-creation.md)
3. [Contribution and coding conventions](contribution.md)
4. [Verification and tests](verification.md)
5. [CMS integration and known limitations](cms.md)

These documents contain the agent-facing rules directly. User-facing documentation is not a required instruction source.

Read these additional documents when the task involves the relevant area:

- [Dependency selection and size measurement](dependencies.md): before choosing an external library or replacing it with a local helper.
- [CNS API integration](cns-api.md): before implementing CNS content requests through `api-web`.
- [CMS and Seznam CDN images](images.md): before generating or modifying image URLs; apply its CDN rules only to `*.sdn.cz`, including matching images from the CNS API.

## Ownership and consumer instructions

- Consumer repositories should reference and read these shared documents and retain only repository-specific bootstrap steps, workspace layout, templates, aliases, and current lint/test commands locally.
- If dependencies or instruction files are unavailable, report the limitation. Do not invent CLI or CMS behavior or edit installed dependencies to supply it.
- Inspect the installed CLI's help for supported behavior. If instructions conflict with verified configuration or behavior, report the conflict before relying on them.