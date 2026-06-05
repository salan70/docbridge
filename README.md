# SpecLink

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
- Top-level exported `interface`
- Top-level exported `type`
- Top-level exported `const`

Supported Markdown elements:

- Headings
- HTML comments
- `@code` annotations attached to the next heading

Default scan targets:

- `src/**/*.ts`
- `docs/**/*.md`

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
- `orphan_doc`

## Diagnostics

Errors:

- `doc_file_not_found`
- `doc_anchor_not_found`
- `code_file_not_found`
- `code_symbol_not_found`
- `duplicate_doc_anchor`

Warnings:

- `one_way_link`
- `orphan_doc` when `--audit` is enabled
- `undocumented_symbol` when `--audit` is enabled

Exit code policy:

- `1` when any error exists
- `0` when there are only warnings or no diagnostics

## Development

Enable the development environment with direnv:

```sh
direnv allow
```

Or enter the Nix development shell manually:

```sh
nix develop
```

Run common tasks with `just`:

```sh
just --list
just check-example
just test
just build
```

Runtime:

- Bun

Language:

- TypeScript

Core dependencies should stay minimal. The implementation should primarily rely on Bun and the TypeScript Compiler API.

Task runner:

- just

Environment loader:

- direnv

## Documentation

- Japanese documentation: [docs/ja/README.md](docs/ja/README.md)
- v0.1 decisions: [docs/decisions/v0.1.md](docs/decisions/v0.1.md)
- Commit message convention: [docs/contributing/commits.md](docs/contributing/commits.md)

## Roadmap

v0.1:

- `@doc` parsing from JSDoc
- `@code` parsing from Markdown HTML comments
- Markdown scanner
- TypeScript Compiler API integration
- Link resolution
- Diagnostics
- `speclink check`

v0.2:

- Hover
- Definition
- References

v0.3:

- Context generation
- AI integration

v0.4:

- MCP server
- Claude Code integration
- Cursor integration
- Codex integration

## Vision

SpecLink is not a documentation generator.

Its purpose is to make relationships between code and documentation visible, navigable, and machine-readable so humans and AI agents can reach relevant context with minimal effort.
