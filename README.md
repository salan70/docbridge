# DocBridge

[![npm version](https://img.shields.io/npm/v/docbridge.svg)](https://www.npmjs.com/package/docbridge)
[![Japanese README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](docs/ja/README.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/salan70/docbridge)

Bring Markdown into the LSP world.

DocBridge creates bidirectional links between TypeScript, Swift, Dart, or Rust code
and Markdown documentation, enabling LSP-like experiences such as Hover,
Definition, References, and Diagnostics across implementation and specification
files.

## Installation

DocBridge is distributed as the `docbridge` npm package and runs on Node.js
(>= 22) and Bun:

```sh
npx docbridge check
# or
bunx docbridge check
```

See the npm badge above or
[Releases](https://github.com/salan70/docbridge/releases) for the current
version.

The package includes prebuilt Swift, Dart, and Rust scanner
binaries for `darwin-arm64` and `linux-x64`. TypeScript and Markdown checks run
without scanner binaries. Configured Swift, Dart, or Rust projects on unsupported
platforms report `code_scanner_unavailable` and name the supported platform
keys.

## Quick Start

Run first-time setup in the project root:

```sh
bunx docbridge init
```

For agent-guided adoption, install the `docbridge` skill and print setup
commands. The skill routes adopt, link, review, and sync work:

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

Discover a command:

```sh
bunx docbridge --help
bunx docbridge context --help
```

Every command accepts `--help` (alias `-h`) and prints its usage, when to use
it, and its options on stdout.

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

- `undocumented_symbol` — in-scope code endpoints with no `@doc`
- `unlinked_doc_section` — in-scope documentation sections with no `@code`

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
scanned in-process; Swift, Dart, and Rust are scanned through bundled first-party
worker packages.

## Supported Inputs

DocBridge recognizes the following elements.

Supported code declarations:

- TypeScript top-level exported declarations: `function`, `class`,
  `abstract class`, `interface`, `type`, `const`, `enum`, and supported
  `declare` / named default forms
- TypeScript type members: class methods, properties, accessors, constructors,
  and static members, plus interface and object-type-alias signatures
- Swift public/open declarations and configured internal declarations:
  top-level and member types, functions, variables, constants, initializers,
  and extension members
- Dart public declarations: top-level functions/variables, classes, enums,
  mixins, constructors, fields, accessors, methods, and extension members
- Rust `pub` declarations (and configured non-`pub` with `visibility`):
  modules, structs, enums, free functions, and inherent `impl` methods

Supported Markdown elements:

- ATX headings
- HTML comments
- `@code` annotations attached to the next heading

All four languages use the same `@doc` and `@code` model. Code fragments are
the scanner-produced canonical IDs, so members are type-qualified.

TypeScript member IDs carry no parameter signature; overload signatures and a
getter/setter pair each collapse to one endpoint, and the constructor is
`<Type>.constructor`. By default `public` and `protected` members are scanned;
`private` members require `include.code.typescript.visibility`. Members are
linkable but are never reported by `check --audit`.

```ts
export class AuthService {
  /** @doc docs/auth.md#login-spec */
  login(email: string, password: string): void {}
}
```

```md
<!-- @code src/auth/service.ts#AuthService.login -->

## Login Spec
```

Swift, Dart, and Rust canonical IDs follow their own conventions:

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

Swift, Dart, and Rust projects must build their scanner workers in source checkouts
before checking those languages. Run `just build-swift-scanner` for Swift,
`just build-dart-scanner` for Dart, and `just build-rust-scanner` for Rust, or
use the native test recipes below.

## AI agent integration

DocBridge's link graph is built to be consumed by AI coding agents:

- [docs/integrations](docs/integrations) — recipes for Claude Code, Codex,
  and CI: gate triage with `docbridge related --gate`, counterpart content with
  `docbridge context`, and PR reporting.
- [templates/skills](templates/skills) — the distributable `docbridge` skill
  installed by `docbridge init` and `docbridge init-with-agent`. Facts about
  the binary live in `docbridge docs show`. Existing five-skill installs remain
  until `docbridge init --force`.

This repository dogfoods the skills under `.claude/` and `.agents/`, and keeps
its guardrail in the Git `pre-commit` hook under `.githooks/` rather than in
any agent's configuration.

## Editor support

DocBridge ships a language server that exposes the same link graph to editors:

```sh
docbridge lsp
```

`docbridge lsp` speaks LSP over stdio and provides Diagnostics, Hover,
Definition, and References across linked code and Markdown. It takes no
options; the project root comes from the editor's `initialize` request.
`docbridge check` is unchanged.

A VS Code-compatible extension lives in [editors/vscode](editors/vscode). It
packages the language server into a VSIX for VS Code and Cursor. Install
[`salan70.docbridge`](https://marketplace.visualstudio.com/items?itemName=salan70.docbridge)
from VS Code Marketplace. Bun must be available to the editor; set
`docbridge.bunPath` if the GUI cannot find `bun` on `PATH`.

Contributors can still stage the supported `dist/bin/darwin-arm64` and
`dist/bin/linux-x64` scanner artifacts and build a local VSIX:

```sh
just package-vsix
just verify-vsix
```

Registry publication remains manual (`VSCE_PAT=<token> just
publish-vscode-extension`). Open VSX delivery is out of scope. Zed integration
is tracked separately and is not yet implemented. MCP delivery is out of scope
until a concrete consumer requires a long-lived tool server. Full LSP behavior
is specified in [docs/specs/lsp.md](docs/specs/lsp.md).

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
- `code_scanner_unavailable`
- `code_scanner_failed`
- `file_read_error`

Warnings:

- `duplicate_link`
- `dangling_code_annotation`
- `unsupported_declaration`
- `undocumented_symbol` when `--audit` is enabled
- `unlinked_doc_section` when `--audit` is enabled

Exit code policy:

- `1` when any error exists
- `0` when there are only warnings or no diagnostics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pinned development environment,
repository setup, testing matrix, commit convention, and pull request workflow.

## Documentation

- Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Japanese documentation: [docs/ja/README.md](docs/ja/README.md)
- Specifications: [docs/specs](docs/specs)
- v0.1 decisions: [docs/decisions/v0.1.md](docs/decisions/v0.1.md)
- v0.2 decisions: [docs/decisions/v0.2.md](docs/decisions/v0.2.md)
- v0.3 decisions: [docs/decisions/v0.3.md](docs/decisions/v0.3.md)
- AI agent integration recipes: [docs/integrations](docs/integrations)
- Commit message convention: [docs/contributing/commits.md](docs/contributing/commits.md)
- Pull request convention: [docs/contributing/pull-requests.md](docs/contributing/pull-requests.md)
- Testing convention: [docs/contributing/testing.md](docs/contributing/testing.md)

## Roadmap

Completed v0.1–v0.6 capabilities are documented above and in
[CHANGELOG.md](CHANGELOG.md).

Remaining editor delivery work:

- Follow-up automation for GitHub Release VSIX attachment and registry
  publishing after the manual flow is proven
- Add a separate Zed integration path

## Vision

DocBridge is not a documentation generator.

Its purpose is to make relationships between code and documentation visible, navigable, and machine-readable so humans and AI agents can reach relevant context with minimal effort.
