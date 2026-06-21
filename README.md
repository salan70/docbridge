# DocBridge

[![npm version](https://img.shields.io/npm/v/docbridge.svg)](https://www.npmjs.com/package/docbridge)
[![Japanese README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](docs/ja/README.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/salan70/docbridge)

Bring Markdown into the LSP world.

DocBridge creates bidirectional links between TypeScript, Swift, or Dart code
and Markdown documentation, enabling LSP-like experiences such as Hover,
Definition, References, and Diagnostics across implementation and specification
files.

## Installation

DocBridge is distributed as the `docbridge` npm package and is intended to run
with Bun:

```sh
bunx docbridge check
```

The current release is
[v0.4.0](https://github.com/salan70/docbridge/releases/tag/v0.4.0), published
as `docbridge@0.4.0` on npm.

The npm package is Bun-only; Node.js runtime compatibility is not part of the
initial distribution. The package includes prebuilt Swift and Dart scanner
binaries for `darwin-arm64` and `linux-x64`. TypeScript and Markdown checks run
without scanner binaries. Configured Swift or Dart projects on unsupported
platforms report `code_scanner_unavailable` and name the supported platform
keys.

## Quick Start

Run first-time setup in the project root:

```sh
bunx docbridge init
```

For agent-guided adoption, install `docbridge-adopt` and print setup commands:

```sh
bunx docbridge init-with-agent
```

Preview planned file operations without writing:

```sh
bunx docbridge init --dry-run
```

You can also create `docbridge.config.json` manually:

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Link an exported TypeScript declaration to a Markdown section:

```ts
/**
 * @doc docs/auth.md#login-spec
 */
export async function login() {
  // ...
}
```

Add the backlink in the Markdown file:

```md
<!-- @code src/auth/login.ts#login -->
## Login Spec

Login flow specification.
```

Check the project:

```sh
bunx docbridge check
```

## Usage

Check links:

```sh
bunx docbridge check
```

Check another project root:

```sh
bunx docbridge check --root examples/typescript
```

Emit JSON:

```sh
bunx docbridge check --json
```

Run audit diagnostics:

```sh
bunx docbridge check --audit
```

Audit diagnostics include:

- `undocumented_symbol`

List the linked counterparts of changed files:

```sh
git diff --name-only | bunx docbridge related --stdin
```

`docbridge related` is informational: it reports each counterpart and whether it
is itself in the change set, and always exits `0` on success. Changed files can
also be passed as positional arguments. Add `--gate` to report only the
counterparts that are not themselves in the change set and exit `1` when any
exist. Both modes support `--root` and `--json`. See
[docs/specs/cli.md](docs/specs/cli.md) for details.

Print the content of the linked counterparts of changed files:

```sh
git diff --name-only | bunx docbridge context --stdin
```

`docbridge context` answers "what do the linked counterparts say": full
Markdown sections for doc counterparts, full declarations including JSDoc for
code counterparts. The default output is Markdown suitable for direct
injection into an agent prompt; `--json` follows
[schemas/context-output.schema.json](schemas/context-output.schema.json).
Extraction is best-effort and the command exits `0` on success even when the
tree has broken links. See [docs/specs/cli.md](docs/specs/cli.md) for details.

Inspect the resolved link graph:

```sh
bunx docbridge graph
bunx docbridge graph --json --include-content
```

`docbridge graph` prints the resolved endpoint graph, including resolvable
one-way links. JSON output follows
[schemas/graph-output.schema.json](schemas/graph-output.schema.json).

## Why DocBridge

Modern software projects often suffer from a gap between implementation and
documentation:

- Code changes without documentation updates
- Documentation changes without implementation updates
- Difficulty finding which specifications relate to a given implementation
- Difficulty finding which implementation relates to a given specification
- AI coding agents missing relevant context during code modifications

DocBridge makes relationships between code and documentation explicit,
navigable, and machine-readable.

## Concept

Traditional documentation tools often focus on one direction:

```text
Code -> Documentation
```

DocBridge focuses on both directions:

```text
Code <-> Documentation
```

DocBridge links supported code declarations to Markdown sections. TypeScript is
scanned in-process; Swift and Dart are scanned through bundled first-party
worker packages.

## Supported Inputs

DocBridge recognizes the following elements.

Supported code declarations:

- TypeScript top-level exported declarations: `function`, `class`,
  `abstract class`, `interface`, `type`, `const`, `enum`, and supported
  `declare` / named default forms
- Swift public/open declarations and configured internal declarations:
  top-level and member types, functions, variables, constants, initializers,
  and extension members
- Dart public declarations: top-level functions/variables, classes, enums,
  mixins, constructors, fields, accessors, methods, and extension members

Supported Markdown elements:

- ATX headings
- HTML comments
- `@code` annotations attached to the next heading

Swift and Dart use the same `@doc` and `@code` model. Their code fragments are
the scanner-produced canonical IDs, so members are type-qualified:

```swift
/// @doc docs/auth.md#login-spec
public struct AuthService {
  public func login(email: String, password: String) {}
}
```

```md
<!-- @code Sources/AuthService.swift#AuthService.login(email:password:) -->
## Login Spec
```

Projects must define scan targets in `docbridge.config.json`. There is no
implicit default configuration; when the config file is missing, DocBridge
reports `config_file_invalid` and does not scan project files.

Minimal TypeScript configuration:

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Multilanguage configuration is language-keyed. The old `include.code` array
shape is intentionally invalid; migrate it to a `typescript` entry:

```json
{
  "include": {
    "code": {
      "typescript": { "patterns": ["src/**/*.ts"] },
      "swift": { "patterns": ["Sources/**/*.swift"] },
      "dart": { "patterns": ["lib/**/*.dart"] }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Swift and Dart projects must build their scanner workers in source checkouts
before checking those languages. Run `just build-swift-scanner` for Swift and
`just build-dart-scanner` for Dart, or use the native test recipes below.

## AI agent integration

DocBridge's link graph is built to be consumed by AI coding agents:

- [docs/integrations](docs/integrations) — recipes for Claude Code, Codex,
  and CI: on-edit counterpart awareness with `docbridge context`, gate triage
  with `docbridge related --gate`, and PR reporting.
- [examples/hooks](examples/hooks) — copyable agent hook scripts implementing
  those recipes.
- [templates/skills](templates/skills) — distributable agent skills installed by
  `docbridge init` and `docbridge init-with-agent`:
  `docbridge-annotate`, `docbridge-sync`, `docbridge-adopt`, `docbridge-link`,
  and `docbridge-review`.

This repository dogfoods the hooks and skills in its own guardrails under
`.claude/`, `.codex/`, and `.agents/`.

## Editor support

DocBridge ships a language server that exposes the same link graph to editors:

```sh
docbridge lsp
```

`docbridge lsp` speaks LSP over stdio and provides Diagnostics, Hover,
Definition, and References across linked code and Markdown. It takes no
options; the project root comes from the editor's `initialize` request.
`docbridge check` is unchanged.

A minimal VS Code-compatible client lives in [editors/vscode](editors/vscode);
see its README to install it into VS Code or Cursor for local testing. Full
behavior is specified in [docs/specs/lsp.md](docs/specs/lsp.md).

## Diagnostics

Errors:

- `config_file_invalid`
- `config_unknown_key`
- `config_invalid_value`
- `invalid_link_target`
- `doc_file_not_found`
- `doc_anchor_not_found`
- `code_file_not_found`
- `code_backlink_not_found`
- `doc_backlink_not_found`
- `duplicate_doc_anchor`
- `duplicate_code_symbol`
- `code_parse_error`
- `file_read_error`

Warnings:

- `duplicate_link`
- `dangling_code_annotation`
- `unsupported_declaration`
- `undocumented_symbol` when `--audit` is enabled

Exit code policy:

- `1` when any error exists
- `0` when there are only warnings or no diagnostics

## Development

### Prerequisites

Recommended:

- Nix
- direnv

The Nix development shell provides the tools used by this repository:

- Bun
- just
- Git
- Dart SDK

If you do not use Nix, install Bun and just locally before running the project
commands. Swift scanner development also requires a Swift 6 toolchain on
`PATH`; CI installs Swift separately from Nix.

### Setup

Enable the development environment with direnv:

```sh
direnv allow
```

Or enter the Nix development shell manually:

```sh
nix develop
```

Install dependencies:

```sh
bun install --frozen-lockfile
```

Install repository Git hooks:

```sh
just install-git-hooks
```

If `just` is not on `PATH` yet, run:

```sh
nix develop -c just install-git-hooks
```

The pre-commit hook runs `just check` and `just test`.

### Common Tasks

Run common tasks with `just`:

```sh
just --list
just check
just check-example
just check-swift-example
just check-dart-example
just check-fixture <code>
just audit
just related-gate
just test
just test-swift-scanner
just test-dart-scanner
just build
just verify-dist
```

`just check`, `just test`, and `just build` are the default local and CI gates.
`just test` includes TypeScript, Swift, and Dart end-to-end integration tests;
the Swift and Dart scanner binaries must be built before those integration
tests can spawn them. Scanner-native tests are mandatory in CI and are useful
locally when changing worker code. `just verify-dist` builds confidence in the
npm entry point by checking the Bun shebang, executable bit, `--version`,
`--help`, and a TypeScript example check from `dist/index.js`.

### Project Constraints

Runtime:

- Bun

Language:

- TypeScript
- Swift scanner worker package
- Dart scanner worker package

Task runner:

- just

Environment loader:

- direnv

Core dependencies should stay minimal. The CLI should primarily rely on Bun and
the TypeScript Compiler API; Swift and Dart parser dependencies stay isolated
inside their worker packages.

## Documentation

- Japanese documentation: [docs/ja/README.md](docs/ja/README.md)
- Specifications: [docs/specs](docs/specs)
- v0.1 decisions: [docs/decisions/v0.1.md](docs/decisions/v0.1.md)
- v0.2 decisions: [docs/decisions/v0.2.md](docs/decisions/v0.2.md)
- v0.3 decisions: [docs/decisions/v0.3.md](docs/decisions/v0.3.md)
- AI agent integration recipes: [docs/integrations](docs/integrations)
- Commit message convention: [docs/contributing/commits.md](docs/contributing/commits.md)
- Testing convention: [docs/contributing/testing.md](docs/contributing/testing.md)

## Roadmap

Completed v0.1–v0.4 capabilities are documented above and in
[CHANGELOG.md](CHANGELOG.md). The current roadmap tracks upcoming work only.

v0.5:

- MCP server exposing the link graph and `docbridge context` output as tools
- Editor and agent delivery channels built on it (Claude Code, Cursor, Zed,
  Codex)

## Vision

DocBridge is not a documentation generator.

Its purpose is to make relationships between code and documentation visible, navigable, and machine-readable so humans and AI agents can reach relevant context with minimal effort.
