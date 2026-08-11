# Rust Language Support Plan

This plan breaks [issue #109](https://github.com/salan70/docbridge/issues/109)
into implementation slices that follow the Swift/Dart first-party worker
pattern. Each slice should leave the repository in a working state.

Normative behavior is reflected in these specs as the slices land:

- [Configuration](../../specs/configuration.md)
- [Scanning](../../specs/scanning.md)
- [Annotations](../../specs/annotations.md)
- [Diagnostics](../../specs/diagnostics.md)

## Status

- [x] Slice 1: Core registry + schema
- [x] Slice 2: Rust scanner worker (`packages/rust-scanner/`)
- [x] Slice 3: End-to-end integration (`examples/rust/`, tests, specs)
- [x] Slice 4: Release readiness (CI, staging, skill/docs language lists)

## Goals

- Add `"rust"` as a first-party code language with `include.code.rust`.
- Ship `docbridge-rust-scanner` speaking schemaVersion 1 of the shared worker
  protocol, using `syn` + `proc-macro2` with `span-locations`.
- Support the MVP declaration set and doc-comment forms needed for crates such
  as repomonk without adopting DocBridge inside that project.
- Keep Markdown `@code`, resolver, graph, context, CLI, and LSP
  language-neutral beyond registry/fence/editor IDs.

## Non-Goals

- Adopting DocBridge inside external Rust projects (follow-up via
  `docbridge-adopt`).
- Full coverage of every Rust item kind (custom traits, trait-impl methods,
  macros, const/static, unions, extern blocks) in the first delivery.
- Regex / heuristic scanners or third-party scanner plugins.
- Persistent long-lived workers or large-monorepo performance work.
- Changing the shared link model beyond registering a new language.

## Design Decisions

### Parser

Use `syn` with `full` features and `proc-macro2` with `span-locations`. Prefer
the official AST ecosystem over `ra_ap_syntax` (version churn) or
tree-sitter-rust (heuristic bar).

### Configuration

```json
{
  "include": {
    "code": {
      "rust": {
        "patterns": ["src/**/*.rs"],
        "visibility": ["pub"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

- Patterns must end with `.rs`.
- Visibility values: `pub` and `private`. Default when omitted: `["pub"]`.
  - `pub` means unrestricted `pub` visibility (`Visibility::Public`).
  - `private` means every other visibility (`pub(crate)`, `pub(super)`,
    `pub(in path)`, and inherited/private).
- Init discovery patterns: `src/**/*.rs`, `*/src/**/*.rs`. Exclude `target/`,
  `tests/`, `benches/`, `examples/` when discovering.

### MVP declaration set

Supported and linkable when visible:

- `mod` (including nested modules)
- `struct`
- `enum`
- free `fn`
- inherent `impl` methods (`impl Type { fn method }`)

`@doc` on unsupported items (trait definitions, trait impls, macros,
const/static, unions, extern blocks, type aliases, etc.) reports
`unsupported_declaration`.

### Canonical IDs

Rust path style with `::`:

| Kind             | Example ID              |
| ---------------- | ----------------------- |
| Free function    | `normalize`             |
| Struct / enum    | `TypingEngine`          |
| Inherent method  | `TypingEngine::advance` |
| Nested module    | `domain::typing`        |
| Top-level module | `domain`                |

Trait-impl methods are out of MVP scope; if annotated they are unsupported
rather than given a colliding `Type::method` ID.

### Doc comments

Extract `@doc\s+(\S+)` from:

- Outer `///` and `/** */` (surfaced by syn as `#[doc = "..."]`)
- Inner `//!` and `/*! */` on `mod` items (`#![doc = "..."]`)

File-level crate inner docs without a surrounding `mod` item are ignored in
MVP (no file-module symbol).

### Positions

Convert byte offsets from syn spans to UTF-16, 1-based, end-exclusive positions,
matching TypeScript / Swift / Dart scanners.

### Executable

- Name: `docbridge-rust-scanner`
- Source candidates: `packages/rust-scanner/target/{release,debug}/`
- Dist: `dist/bin/<platform>/docbridge-rust-scanner`
- Platforms: `darwin-arm64`, `linux-x64` (same as existing workers)

Pin the toolchain with `packages/rust-scanner/rust-toolchain.toml`.

## Slices

### Slice 1: Core registry + schema

- Extend `CodeLanguage` / `KNOWN_CODE_LANGUAGES`.
- Config maps: suffix `.rs`, visibility `pub` | `private`, init patterns,
  context fence `rust`.
- Update `schemas/docbridge.schema.json`, `scanner-worker.schema.json`,
  `common-output.schema.json`.
- Register the worker adapter and executable resolution paths.

### Slice 2: Rust scanner worker

- Create `packages/rust-scanner/` with library + binary + tests.
- Implement the shared JSON protocol and MVP declaration/canonical-ID rules.
- Add `just` recipes: `build-rust-scanner`, `test-rust-scanner`, fold into
  `build-test-scanners`.

### Slice 3: End-to-end integration

- `examples/rust/` with config, `src/*.rs`, and `docs/*.md`.
- Integration and conformance tests; diagnostic fixtures when useful.
- Spec updates for scanning, annotations, and configuration.

### Slice 4: Release readiness

- CI and release workflows build/stage/chmod the Rust scanner.
- `stage-scanner-binaries`, pack smoke, VS Code language activation.
- User docs, README language lists, and skill templates.

## Acceptance Mapping

| Acceptance criterion                                            | Slice |
| --------------------------------------------------------------- | ----- |
| `include.code.rust` valid; non-`.rs` rejected; default pub-only | 1     |
| First-party worker buildable via justfile                       | 2     |
| MVP decls + doc comments → `CodeScanResult`-compatible output   | 2–3   |
| `examples/rust/` passes `docbridge check`                       | 3     |
| Specs document Rust rules                                       | 3     |
| CI packages for release platforms                               | 4     |
| Missing/failing scanners emit existing diagnostics              | 1–2   |
