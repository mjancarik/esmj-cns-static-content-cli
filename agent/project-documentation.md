# Project documentation and instruction ownership

## Three instruction levels

Read and follow all applicable levels before working on a project. Links are not automatic imports; open the referenced files.

1. **General:** the installed CLI's [shared agent instructions](AGENTS.md) apply across projects. Do not copy generic CLI integration, commands, or common rules into consumer-specific files.
2. **Monorepo:** the repository-root `AGENTS.md` references the CLI instructions and links to relevant files in the root `agent/` directory. Put monorepo-specific workspace layout, processes, shared conventions, and other extended instructions in those files; do not put one project's details there.
3. **Project:** `packages/<project-name>/AGENTS.md` contains only instructions specific to that project and references the monorepo-root `AGENTS.md`. For a different workspace layout, use the actual project root. Keep project-specific requirements and human documentation in that project's directory.

Preserve existing instructions and links; create or update consumer files when needed for the work. Do not duplicate shared guidance. If instructions conflict, report the conflict rather than silently choosing one.

## Project README

Create or maintain `README.md` in the project directory as concise, high-level documentation for people. Include only information specific to that project, such as its purpose, significant behavior, data sources and calculations. Exclude generic CLI integration, standard commands, and information common to all projects. Keep it no longer than one A4 page.

When the project makes API requests, include a compact request-flow diagram showing which requests run in parallel and which depend on earlier responses. Describe meaningful computations and their inputs and outputs. For example:

```text
Project start
  ├─ request A ─┐
  └─ request B ─┴─> calculation ─> display
```

Document actual behavior, not an assumed design. Do not include credentials, tokens, private data, or sensitive query values.

## Project task definition

Create or maintain `TASK.md` in the project directory as the project's task definition. It should provide enough project-specific requirements and context to rebuild the project from scratch: purpose, intended users and behavior, inputs and outputs, relevant data sources and integrations, calculations, constraints, and acceptance criteria as applicable. Include references to authoritative task definitions or design sources when available.

Keep the definition accurate as requirements change, distinguish confirmed requirements from unresolved questions, and do not invent missing details or include secrets. Do not replace the human-facing overview in `README.md` with the full task definition.

## End of task or session

Before finishing a task or session on a project, check whether its `README.md` or `TASK.md` needs to be created or updated to reflect the current task and behavior. Make the necessary updates; if a requirement cannot be established or documentation cannot be updated, report the gap. Update monorepo or project `AGENTS.md` instructions only when their respective scoped guidance needs to change. Run the project verification command described in [verification](verification.md), and report failures or blockers.
