# SpecLink

[![Japanese README](https://img.shields.io/badge/README-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](docs/ja/README.md)

Bring Markdown into the LSP world.

SpecLink creates bidirectional links between TypeScript code and Markdown documentation, enabling LSP-like experiences such as Hover, Definition, References, and Diagnostics across implementation and specification files.

## Motivation

Modern software projects often suffer from a gap between implementation and documentation:

- Code changes without documentation updates
- Documentation changes without implementation updates
- Difficulty finding which specifications relate to a given implementation
- Difficulty finding which implementation relates to a given specification
- AI coding agents missing relevant context during code modifications

SpecLink makes relationships between code and documentation explicit, navigable, and machine-readable.

## Concept

Traditional documentation tools often focus on one direction:

```text
Code -> Documentation
```

SpecLink focuses on both directions:

```text
Code <-> Documentation
```

In v0.1, SpecLink links top-level exported TypeScript symbols to Markdown sections.

## Example

TypeScript:

```ts
/**
 * @doc docs/auth.md#login-spec
 */
export async function login() {
  // ...
}
```

Markdown:

```md
<!-- @code src/auth/login.ts#login -->
## Login Spec

Login flow specification.
```

## v0.1 Scope

The first milestone focuses on `speclink check`.

Supported TypeScript declarations:

- Top-level exported `function`
- Top-level exported `class`
- Top-level exported `abstract class`
- Top-level exported `interface`
- Top-level exported `type`
- Top-level exported `const`
- Top-level exported `enum`

Supported Markdown elements:

- ATX headings
- HTML comments
- `@code` annotations attached to the next heading

Default scan targets:

- `src/**/*.ts`
- `docs/**/*.md`

Projects can override scan targets with `speclink.config.json`.

## CLI

Check links:

```sh
just check
```

Check another root:

```sh
just check-example
```

Emit JSON:

```sh
just check-example-json
```

Run audit diagnostics:

```sh
just audit
```

Audit diagnostics include:

- `undocumented_symbol`

## Editor support (v0.2)

SpecLink ships a language server that exposes the same link graph to editors:

```sh
speclink lsp
```

`speclink lsp` speaks LSP over stdio and provides Diagnostics, Hover,
Definition, and References across linked TypeScript and Markdown. It takes no
options; the project root comes from the editor's `initialize` request.
`speclink check` is unchanged.

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
- `typescript_parse_error`
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

If you do not use Nix, install Bun and just locally before running the project
commands.

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
just audit
just test
just build
```

### Project Constraints

Runtime:

- Bun

Language:

- TypeScript

Task runner:

- just

Environment loader:

- direnv

Core dependencies should stay minimal. The implementation should primarily rely
on Bun and the TypeScript Compiler API.

## Documentation

- Japanese documentation: [docs/ja/README.md](docs/ja/README.md)
- Specifications: [docs/specs](docs/specs)
- v0.1 decisions: [docs/decisions/v0.1.md](docs/decisions/v0.1.md)
- v0.2 decisions: [docs/decisions/v0.2.md](docs/decisions/v0.2.md)
- Commit message convention: [docs/contributing/commits.md](docs/contributing/commits.md)
- Testing convention: [docs/contributing/testing.md](docs/contributing/testing.md)

## Roadmap

Completed v0.1 and v0.2 capabilities are documented above and in
[CHANGELOG.md](CHANGELOG.md). The current roadmap tracks upcoming work only.

v0.3:

- Context generation
- AI integration

v0.4:

- MCP server
- Claude Code integration
- Cursor integration
- Zed integration
- Codex integration

## Vision

SpecLink is not a documentation generator.

Its purpose is to make relationships between code and documentation visible, navigable, and machine-readable so humans and AI agents can reach relevant context with minimal effort.
