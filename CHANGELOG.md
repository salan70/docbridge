# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `speclink context`: prints the content of the counterparts linked from a set
  of input files (positional arguments or newline-separated stdin via
  `--stdin`) — full Markdown sections for doc counterparts, full declarations
  including JSDoc for code counterparts. Default output is Markdown suitable
  for direct injection into an agent prompt; `--json` emits a machine-readable
  report following `schemas/context-output.schema.json`. Extraction is
  best-effort: check diagnostics located in the input files are reported on
  stderr (or in the `diagnostics` field) without affecting the exit code.
- TypeScript scanner: records a `declarationRange` covering each supported
  declaration including its JSDoc block, backing `context` content extraction.
- `just context`: prints the linked counterpart content of the uncommitted
  changes.
- AI integration recipes under `docs/integrations/`: on-edit counterpart
  awareness and gate triage for Claude Code and Codex, and a CI recipe for
  gating the PR change set and reporting counterpart content.
- Copyable agent hook scripts under `examples/hooks/`: a `PostToolUse` hook
  that surfaces linked counterpart content on edit, and a `Stop` hook that
  reports `related --gate` findings with the flagged counterparts' content as
  Stop `additionalContext`.
- Distributable agent skills under `templates/skills/`: `speclink-annotate`
  (create `@doc`/`@code` link pairs and verify them with `speclink check`) and
  `speclink-sync` (triage `related --gate` findings using `speclink context`).
  Both are also installed in this repository's `.claude/skills/`.

### Changed

- Markdown section extraction moved from the LSP layer into `src/core/` and is
  now shared by LSP hover and `speclink context` (no behavior change).

## [0.2.0] - 2026-06-11

### Added

- `speclink related`: an informational command that lists the linked
  counterparts of a set of changed files (positional arguments or
  newline-separated stdin via `--stdin`), marking whether each counterpart is
  itself in the change set. Designed to sit behind `git diff --name-only` in
  pre-commit hooks and CI. Supports `--root` and `--json`; always exits `0` on
  success.
- `speclink related --gate`: a gate mode that reports only the counterparts
  that are not themselves in the change set and exits `1` when any exist. The
  check is symmetric (changed code with unchanged linked docs, and changed
  docs with unchanged linked code). Combines with `--json` for a
  machine-readable violations report.
- `speclink lsp`: a Language Server over stdio that exposes the SpecLink link
  graph to editors, with JSON-RPC `Content-Length` framing and the standard
  `initialize` / `initialized` / `shutdown` / `exit` lifecycle.
- `textDocument/publishDiagnostics`: the existing v0.1 diagnostics surfaced in
  the editor, refreshed on document changes with a short debounce.
- `textDocument/hover`: inline Markdown spec sections for linked code symbols,
  and the declaration signature line for linked headings.
- `textDocument/definition` and `textDocument/references` over the symmetric
  counterpart relation, including one-to-many navigation.
- Scanner range enrichment (`nameRange`, `headingTextRange`, `targetRange`) and
  a whole-project model with buffer overlay backing the language server.
- A minimal VS Code client extension under `editors/vscode/` to verify the
  server in a real editor.

## [0.1.0] - 2026-06-07

Initial release of the SpecLink CLI.

### Added

- `@doc` annotation parsing from TypeScript JSDoc via the TypeScript Compiler API.
- `@code` annotation parsing from Markdown HTML comments.
- Markdown scanner with v0.1 heading anchor generation.
- Configuration loading (`speclink.config.json`) with `*`/`**` glob scanning.
- Bidirectional link resolution between code and documentation.
- Deterministic, machine-readable diagnostics.
- `speclink check` command with `--root`, `--json`, and `--audit` options.
- `speclink --version` (alias `-v`) and `speclink --help` (alias `-h`).

[Unreleased]: https://github.com/salan70/spec-link/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/salan70/spec-link/releases/tag/v0.2.0
[0.1.0]: https://github.com/salan70/spec-link/releases/tag/v0.1.0
