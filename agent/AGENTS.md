# Agent instructions

This directory is the canonical shared instruction source shipped by `@esmj/cns-static-content-cli` for creating and maintaining static-content packages.

## Instruction loading

Read only the documents relevant to the task, using the descriptions below. Markdown links are not automatic imports; open and read the applicable files explicitly. Also follow applicable monorepo and project instructions.

- [Contribution and coding conventions](contribution.md): before modifying project code or styles.
- [Verification and tests](verification.md): for verifying a project task or session, including required commands and applicable checks.
- [Project documentation and instruction ownership](project-documentation.md): when creating or updating project documentation or instructions, and when checking documentation at the end of a task or session.
- [Prerequisites](prerequisites.md): when setting up a workspace or changing dependencies and tooling.
- [Package creation](package-creation.md): when creating a package; not needed for changes to an existing package.
- [CMS integration and known limitations](cms.md): when implementing or changing CMS integration, tracking, links, or iframe behavior.
- [Dependency selection and size measurement](dependencies.md): when choosing an external library or replacing it with a local helper.
- [CNS API integration](cns-api.md): when implementing or modifying CNS content requests through `api-web`.
- [CMS and Seznam CDN images](images.md): when generating or modifying image URLs; apply its CDN rules only to `*.sdn.cz`, including matching images from the CNS API.

## Ownership and consumer instructions

- Keep general instructions in this CLI's shared documents, monorepo-specific instructions in the consumer repository, and project-specific instructions in the individual package. Follow [project documentation and instruction ownership](project-documentation.md) for the locations and links.
- At the end of a task or session, verify the affected project using its CLI verification command and check whether its `README.md` and `TASK.md` need updating. Make necessary documentation updates and report failed or blocked verification.
- If dependencies or instruction files are unavailable, report the limitation. Do not invent CLI or CMS behavior or edit installed dependencies to supply it.
- Inspect the installed CLI's help for supported behavior. If instructions conflict with verified configuration or behavior, report the conflict before relying on them.