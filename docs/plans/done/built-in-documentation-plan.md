# Built-In Documentation Plan

This plan adds version-matched, task-oriented documentation to the installed
DocBridge package and exposes it through the CLI.

Normative behavior is reflected in:

- [CLI](../../specs/cli.md)
- [Configuration](../../specs/configuration.md)
- [Annotations](../../specs/annotations.md)

## Status

- [x] Slice 1: Documentation Reader and CLI Commands
- [x] Slice 2: User Documentation Set
- [x] Slice 3: Package Distribution and Smoke Coverage
- [x] Slice 4: Link Graph, Help, and Release Readiness

## Goals

- Add `docbridge docs list [--json]` and `docbridge docs show <name>`.
- Ship six task-oriented documents under `docs/user/`.
- Read documentation from the installed package so it matches the installed
  DocBridge version and works without network access or a repository checkout.
- Link behavioral user documentation to implementing declarations so
  `docbridge check` detects stale targets.
- Verify the commands after installing the npm tarball in a scratch project.

## Non-Goals

- Full-text documentation search.
- Per-diagnostic `explain` aliases.
- Removing detailed guidance from existing distributable skills.
- Japanese translations of the new user documentation.
- A standalone compiled binary documentation strategy.

## Decisions

### Package Markdown Files

The npm package ships `docs/user/*.md`. The documentation reader resolves the
package root from the running module and reads that directory at command time.
The files remain inspectable inside `node_modules` and require no generated
artifact.

The reader is exposed through a small interface. A future generated-module or
compiled-binary implementation can replace the filesystem reader without
changing command parsing or output.

### Frontmatter Contract

Every user document is a `.md` file with YAML frontmatter containing one
single-line `description` field. The filename without `.md` is its command
name. Listing fails rather than silently publishing a document without a valid
description.

`docs show` removes the frontmatter and its separating blank line, then writes
the remaining Markdown body verbatim. Document ordering is deterministic by
name.

### CLI Contract

`docs list` prints names and descriptions in aligned columns, followed by a
hint for `docs show`. `docs list --json` prints the documented object shape.
`docs show <name>` prints the Markdown body. Unknown names exit with code `1`
and list every available name on stderr.

## Verification

- Focused Bun tests for reader and CLI behavior.
- `just check`
- `just test`
- `just verify`
- `just build`
- `just verify-dist`
- `npm pack` followed by `just pack-smoke <tarball>`
