# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-07-13

### Added

- The npm package now runs on Node.js (>= 22) in addition to Bun: the CLI is
  built for the Node target with a `#!/usr/bin/env node` shebang, so
  `npx docbridge` works without installing Bun. Packaging smoke tests exercise
  the CLI under both runtimes.

## [0.5.2] - 2026-07-12

### Fixed

- Linux x64 release packages now build the Dart scanner with the official Dart
  SDK on Ubuntu 22.04, avoiding Nix store paths and newer glibc requirements
  that made the scanner unavailable on plain Linux hosts.

## [0.5.1] - 2026-07-12

### Removed

- Removed Open VSX from the editor delivery scope and deleted its unused manual
  publishing command; the supported registry target is VS Code Marketplace.

## [0.5.0] - 2026-07-05

### Added

- VS Code-compatible extension packaging and manual publishing support:
  release VSIX generation, VSIX verification, Marketplace/Open VSX publish
  commands, Swift/Dart document activation, and bundled `docbridge lsp`
  startup from the extension package.

### Fixed

- The release publish workflow now restores executable bits on downloaded
  Swift and Dart scanner artifacts before packing the npm tarball, and
  smoke-tests the installed tarball before publishing.

### Changed

- Clarified the current editor delivery state in the English and Japanese
  READMEs, including local VSIX installation and the remaining first-publication
  work for VS Code Marketplace and Open VSX.

## [0.4.1] - 2026-06-21

### Added

- `docbridge init` for CLI-driven first-time setup: repository scope discovery,
  safe `docbridge.config.json` creation, and DocBridge agent skill installation.
- `docbridge init-with-agent` for agent-guided adoption: installs
  `docbridge-adopt` and prints one-shot setup commands without launching an
  agent process.
- `docbridge-adopt` now installs the companion DocBridge skills after adoption
  scope is confirmed.

## [0.4.0] - 2026-06-20

### Added

- npm distribution support for the Bun-only `docbridge` package, including
  `dist/index.js` as the package binary, a runtime package allowlist, dist
  verification, packed-package smoke testing, and release workflow publishing.
- Platform-staged Swift and Dart scanner binary layout under
  `dist/bin/<platform>/`, with initial npm scanner support for `darwin-arm64`
  and `linux-x64`.
- Dart scanner worker support, including analyzer-based `@doc` extraction,
  type/member canonical IDs (without parameter signatures, since Dart has no
  overloading), public-by-naming visibility, and Dart end-to-end
  check/context/graph/LSP integration. The Dart toolchain is provided by the Nix
  dev shell.
- Swift scanner worker support for SwiftPM source checkouts, including
  SwiftSyntax-based `@doc` extraction, type/member canonical IDs, visibility
  filtering, and Swift end-to-end check/context/graph/LSP integration.
- Worker-backed scanner protocol foundation for Swift and Dart adapters,
  including stdin/stdout JSON invocation and scanner availability/failure
  diagnostics.
- `docbridge graph`: prints the resolved link graph as human-readable output or
  as JSON following `schemas/graph-output.schema.json`, including resolvable
  one-way links, pair completeness, optional lightweight node content, and
  diagnostics that do not prevent graph construction.
- Distributable adoption skills under `templates/skills/`: `docbridge-adopt`
  for existing-project setup, `docbridge-link` for docs-first annotation
  candidate confirmation, and `docbridge-review` for whole-graph semantic
  review using `docbridge graph --json --include-content`.

### Changed

- The project, package, command, configuration file, templates, and repository
  URLs were renamed from SpecLink/`speclink` to DocBridge/`docbridge`.
- `docbridge context` and `docbridge graph --json` now carry code language
  metadata for code blocks/nodes so Swift endpoints render and serialize as
  Swift.
- DocBridge's distributable skills are now dogfooded from `.agents/skills/` and
  `.claude/skills/` as symlinks to the canonical `templates/skills/` entries.
- TypeScript scanner endpoints now include `signatureRange` in addition to the
  existing full `declarationRange`, allowing graph consumers to read the
  public JSDoc/signature surface without implementation bodies.

### Fixed

- Worker-backed scanner responses now fail when the returned file list does not
  exactly match the requested files, and worker failures suppress derived link
  diagnostics for the failed file.
- The npm-distributed CLI now resolves its bundled `dist/bin/<platform>` Swift
  and Dart scanner binaries when launched through the `node_modules/.bin`
  symlink, which previously resolved to the wrong directory on Linux and
  reported the scanner as unavailable.

## [0.3.0] - 2026-06-14

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

[Unreleased]: https://github.com/salan70/docbridge/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/salan70/docbridge/releases/tag/v0.6.0
[0.5.2]: https://github.com/salan70/docbridge/releases/tag/v0.5.2
[0.5.1]: https://github.com/salan70/docbridge/releases/tag/v0.5.1
[0.5.0]: https://github.com/salan70/docbridge/releases/tag/v0.5.0
[0.4.1]: https://github.com/salan70/docbridge/releases/tag/v0.4.1
[0.4.0]: https://github.com/salan70/docbridge/releases/tag/v0.4.0
[0.3.0]: https://github.com/salan70/docbridge/releases/tag/v0.3.0
[0.2.0]: https://github.com/salan70/docbridge/releases/tag/v0.2.0
[0.1.0]: https://github.com/salan70/docbridge/releases/tag/v0.1.0
