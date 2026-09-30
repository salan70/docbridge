# Go Language Support Plan

This plan breaks [issue #127](https://github.com/salan70/docbridge/issues/127)
into implementation slices that follow the Swift/Dart/Rust first-party worker
pattern. Each slice should leave the repository in a working state. The
[Rust plan](done/rust-language-support-plan.md) is the direct precedent; this
plan repeats only what differs for Go or what the issue left open.

Normative behavior is reflected in these specs as the slices land:

- [Configuration](../specs/configuration.md)
- [Scanning](../specs/scanning.md)
- [Annotations](../specs/annotations.md)
- [Diagnostics](../specs/diagnostics.md)
- [LSP](../specs/lsp.md)

## Status

- [ ] Slice 1: Core registry + schema
- [ ] Slice 2: Go scanner worker (`packages/go-scanner/`)
- [ ] Slice 3: End-to-end integration (`examples/go/`, tests, specs)
- [ ] Slice 4: Release readiness (CI, staging, user docs, editor activation)

## Goals

- Add `"go"` as a first-party code language with `include.code.go`.
- Ship `docbridge-go-scanner` speaking schemaVersion 1 of the shared worker
  protocol, built from the standard library only (`go/parser`, `go/ast`,
  `go/token`).
- Support the MVP declaration set and both Go doc-comment forms.
- Keep Markdown `@code`, resolver, graph, context, CLI, and LSP
  language-neutral beyond registry/fence/editor IDs.

## Non-Goals

Everything the issue lists as out of scope, in particular:

- package-comment endpoints;
- struct fields, embedded fields, and item kinds beyond the MVP set;
- type checking, import resolution, build-constraint evaluation, or cgo;
- release platforms beyond `darwin-arm64` and `linux-x64`.

## Design Decisions

### Parser

`go/parser` with `parser.ParseComments | parser.SkipObjectResolution`, walking
`*ast.File` directly. No `go/doc`, no `golang.org/x/tools`, no third-party
modules: the worker's `go.mod` has no `require` block.

The worker parses each file in isolation. Build constraints (`//go:build`),
`_test.go` suffixes, and `vendor/` directories are not interpreted by the
scanner; whatever the configured patterns match is scanned. A file with a
leading UTF-8 BOM is accepted as `go/scanner` accepts it, and offsets still
count from the start of the content.

### Configuration

```json
{
  "include": {
    "code": {
      "go": {
        "patterns": ["**/*.go"],
        "visibility": ["exported"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

- Patterns must end with `.go`.
- Visibility values: `exported` and `unexported`. Default when omitted:
  `["exported"]`. A name is exported when `ast.IsExported` reports true.
- Init discovery patterns: `**/*.go`. Discovery excludes `vendor/` and
  `testdata/` path segments and files ending in `_test.go`; the generated
  config still contains only `**/*.go`, so a user who wants tests scanned adds
  nothing and a user who does not lists the exclusions themselves, as with the
  other languages.

### MVP declaration set

Supported and linkable when visible:

| Declaration                           | Symbol per                                 |
| ------------------------------------- | ------------------------------------------ |
| Package-level `func` (no receiver)    | function                                   |
| Method with receiver                  | method                                     |
| Interface method                      | method signature inside `type X interface` |
| Package-level `type` (any underlying) | `TypeSpec`, grouped or not                 |
| Package-level `const` and `var`       | name inside a `ValueSpec`, grouped or not  |

Skipped without a symbol (never `undocumented_symbol`, and an `@doc` on them
is `unsupported_declaration`):

- the blank identifier `_` in any position;
- `func init()`, which a file may declare more than once and which nothing can
  reference;
- embedded interfaces inside an interface body (`io.Reader` has no local name);
- struct fields and embedded fields;
- the `package` clause; an `@doc` in the package comment is
  `unsupported_declaration` located at the package name.

Methods are visible only when both the method name and the receiver or
interface type name are exported (or `unexported` is configured). The receiver
type does not need to be declared in the same file; the scanner is syntactic.

### Canonical IDs

Go selector style with `.`:

| Kind             | Source                             | Example ID     |
| ---------------- | ---------------------------------- | -------------- |
| Function         | `func Login()`                     | `Login`        |
| Type             | `type Server struct{}`             | `Server`       |
| Generic type     | `type List[T any] struct{}`        | `List`         |
| Const / var      | `const MaxRetries = 3`             | `MaxRetries`   |
| Method           | `func (s *Server) Start()`         | `Server.Start` |
| Method, generic  | `func (l *List[T]) Push(v T)`      | `List.Push`    |
| Interface method | `type Reader interface { Read() }` | `Reader.Read`  |

The receiver type name is the base identifier after unwrapping `*`,
parentheses, and type-parameter lists (`IndexExpr`, `IndexListExpr`). A
receiver whose base is not a plain identifier is treated as unsupported. Type
parameters never appear in IDs, so IDs stay stable when a type gains or loses
generics.

Because one Go package cannot declare a struct and an interface of the same
name, `Type.Method` cannot collide between receiver methods and interface
methods. Methods declared for one type across several files stay distinct
because the file path is the endpoint namespace.

### Doc comments and grouped declarations

Go attaches a doc comment to the declaration it immediately precedes, and the
parser exposes that association: `FuncDecl.Doc`, `GenDecl.Doc`,
`TypeSpec.Doc`, `ValueSpec.Doc`, and `Field.Doc` for interface methods. The
scanner reads only these `Doc` groups; trailing line comments
(`ValueSpec.Comment`) and comments inside bodies are never doc comments.

`@doc\s+(\S+)` is matched against the raw text of each `*ast.Comment` in the
group, so `//` and `/* ... */` forms behave identically and the link
`location` is the exact offset of the target. `//go:` directive lines never
carry `@doc`.

Grouped declarations follow these rules:

- Ungrouped `const X = 1` / `var X T` / `type X T`: the parser stores the
  comment in `GenDecl.Doc`, and it belongs to the single spec.
- Parenthesized group, per-spec comment (`ValueSpec.Doc` / `TypeSpec.Doc`):
  the comment belongs to that spec.
- Parenthesized group, group-level comment (`GenDecl.Doc` above `const (`):
  the comment documents the group, which has no name. An `@doc` in it is
  `unsupported_declaration` located at the `const`/`var`/`type` keyword. This
  holds even when the group contains a single spec, so the rule does not
  change when a second spec is added.
- A `ValueSpec` with several names (`var a, b int`): every name is a symbol.
  An `@doc` in that spec's comment is `unsupported_declaration` located at
  the first name, because the annotation cannot say which name it documents.
  Splitting the spec is the fix.
- `iota` blocks need no special handling: every line is its own `ValueSpec`.

These rules mean an `@doc` is either attached to exactly one symbol or
reported; it is never silently duplicated onto several endpoints.

### Positions and ranges

`token.File.Offset` converts every `token.Pos` to a byte offset, and the worker
converts byte offsets to 1-based UTF-16 columns with end-exclusive ranges, as
the other workers do. `//line` directives are ignored: `PositionFor(pos,
false)` is never needed because line/column are derived from the content.

- `location` and `nameRange`: the identifier (`Ident.Pos()`..`Ident.End()`).
- `declarationRange`: from the start of the doc comment when present,
  otherwise the declaration start, to the declaration end. For a spec inside a
  group this is the spec's own range (plus its own doc), not the group's.
- `signatureRange`: for `func` and methods, from the doc comment (or `func`)
  to `FuncType.End()`, excluding the body; for interface methods, the
  `Field` range; for other declarations, equal to `declarationRange`.

### Parse errors

Any error from `parser.ParseFile` makes the file a `code_parse_error` at the
first error's position, with no symbols for that file, matching the other
workers' contract established by the scanner-conformance `parse-error` case.
The partial AST that `go/parser` returns on error is discarded.

### Executable

- Name: `docbridge-go-scanner`
- Layout: `packages/go-scanner/go.mod`, `cmd/docbridge-go-scanner/main.go`
  (stdin/stdout only), `internal/scanner/` (parsing, ranges, ID rules) with
  table-driven `_test.go` files.
- Build output: `packages/go-scanner/bin/docbridge-go-scanner`. Go has no
  debug/release split, so the executable resolver gets one source candidate
  before the `dist/bin/<platform>/` fallback.
- Build: `CGO_ENABLED=0 go build -trimpath` for reproducible, portable static
  binaries. The release matrix builds natively on each runner like the other
  workers; cross-compilation is not used so the matrix stays uniform.
- Toolchain: the `go` directive in `go.mod` is the single pinned version.
  The Nix dev shell adds `pkgs.go`, and the workflows use `actions/setup-go`
  with `go-version-file: packages/go-scanner/go.mod` outside Nix, as the Dart
  and Rust steps do. Pick the version nixpkgs-unstable provides at slice 2 so
  the shell and CI agree.
- Quality recipes: `gofmt -l` for format checks, `go vet ./...` for lint,
  `go test ./...` for tests. No third-party linters.

### Editor and rendering

- Context fence and hover fence language: `go`.
- Go block comments do not nest, so `go` stays out of the LSP
  `NESTED_BLOCK_COMMENTS` set.
- VS Code activation event `onLanguage:go` and document selector
  `{ scheme: "file", language: "go" }`.

## Slices

### Slice 1: Core registry + schema

- Extend `CodeLanguage` and `KNOWN_CODE_LANGUAGES`.
- Config maps: suffix `.go`, visibility `exported` | `unexported`, init
  patterns and the Go exclusion rule, context and hover fence `go`.
- Update `schemas/docbridge.schema.json` (`goEntry`),
  `scanner-worker.schema.json`, `common-output.schema.json`,
  `graph-output.schema.json`, `context-output.schema.json`.
- Register the worker adapter, the executable name, and the source-checkout
  candidate path.
- Unit tests for config validation, discovery, and executable resolution.

### Slice 2: Go scanner worker

- Create `packages/go-scanner/` per [Executable](#executable).
- Implement the protocol, MVP declarations, visibility, canonical IDs, and the
  grouped-declaration rules with table-driven tests covering each row of the
  tables above.
- Add `just` recipes: `format-check-go`, `lint-go`, `test-go-scanner`,
  `build-go-scanner`; fold into `format`, `format-check`, `lint`,
  `build-test-scanners`, and `doctor`.
- Add `pkgs.go` to `flake.nix`.
- Worker-conformance entry and the four `test-fixtures/scanner-conformance/*/go/`
  cases.

### Slice 3: End-to-end integration

- `examples/go/` with `go.mod`, `docbridge.config.json`, source under
  `internal/`, and `docs/*.md`, exercising a function, a type, a receiver
  method, an interface method, and a grouped const.
- `go-integration.test.ts` covering `check`, `context`, graph output, LSP
  navigation and hover, and the link manifest.
- `include.code.go` entries in the diagnostic fixtures that enumerate every
  language; a `unsupported_declaration` fixture case for a group-level `@doc`.
- Spec updates: scanning (new "Go Scanning" section and the worker
  paragraph), configuration, annotations, diagnostics, LSP language lists;
  refresh the self-audit baseline for the new heading.

### Slice 4: Release readiness

- CI: install Go, build and test the worker, pass `--go` to
  `stage-scanner-binaries`.
- Release: build the worker in the `scanner-artifacts` matrix, add it to
  `SHA256SUMS`, the `chmod 755` list, verify-dist, and the packed-package
  smoke fixture.
- User docs (`docs/user/`, `docs/ja/user/`, README, editor README),
  contributor docs, CLAUDE.md/AGENTS.md language lists, and the
  `getting-started` description asserted by `docs.test.ts`.
- VS Code activation and document selector, plus `scripts/vscode-extension.ts`
  expectations.
- CHANGELOG entry; the PR that lands this slice carries `release: minor`.

## Acceptance Mapping

| Acceptance criterion                                                  | Slice |
| --------------------------------------------------------------------- | ----- |
| `include.code.go` valid; non-`.go` rejected; exported-only default    | 1     |
| Worker implements schemaVersion 1 and builds/tests via `just`         | 2     |
| MVP declarations and both comment forms produce protocol output       | 2     |
| Canonical IDs and visibility covered by table-driven tests            | 2     |
| `code_parse_error`, `code_scanner_*`, invalid/duplicate link behavior | 1–3   |
| `examples/go/` passes check, context, graph, and LSP coverage         | 3     |
| Specs and user docs describe the Go contract                          | 3–4   |
| CI builds/tests the worker; release stages, checksums, smoke-tests it | 4     |
| Existing languages keep passing `just verify`                         | 1–4   |
