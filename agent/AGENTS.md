# Agent instructions

These instructions apply to creating and maintaining static-content packages in this repository.

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

## Ownership and future CLI integration

- The intended shared instruction owner is `@esmj/cns-static-content-cli`. Its main agent document and supporting instruction files must ship with the published CLI before this project can reference them.
- The currently installed CLI does not ship an agent document. Until it does, use the local instruction documents above; do not assume a missing dependency document exists.
- When the CLI publishes shared instructions, replace the shared rules here with an explicit relative link and a requirement to read them. Retain repository-specific bootstrap steps, workspace layout, templates, aliases, and current lint/test commands locally.
- If dependencies or instruction files are unavailable, report the limitation. Do not invent CLI or CMS behavior or edit installed dependencies to supply it.
- Inspect the installed CLI's help for supported behavior. If instructions conflict with verified configuration or behavior, report the conflict before relying on them.