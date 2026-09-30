# Go Language Support Plan

This plan breaks [issue #127](https://github.com/salan70/docbridge/issues/127)
into implementation slices that follow the Swift/Dart/Rust first-party worker
pattern. Each slice should leave the repository in a working state. The
[Rust plan](rust-language-support-plan.md) is the direct precedent; this
plan repeats only what differs for Go or what the issue left open.

Normative behavior is reflected in these specs as the slices land:

- [Configuration](../../specs/configuration.md)
- [Scanning](../../specs/scanning.md)
- [Annotations](../../specs/annotations.md)
- [Diagnostics](../../specs/diagnostics.md)
- [LSP](../../specs/lsp.md)

## Status

- [x] Slice 1: Go scanner worker (`packages/go-scanner/`, recipes, Nix, CI)
- [x] Slice 2: Registry, schema, adapter, and conformance fixtures
- [x] Slice 3: End-to-end integration (`examples/go/`, tests, specs)
- [x] Slice 4: Release readiness (release packaging, user docs, editor activation)

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
        "patterns": ["*.go", "cmd/**/*.go", "internal/**/*.go", "pkg/**/*.go"],
        "visibility": ["exported"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

- Patterns must end with `.go`.
- Visibility values: `exported` and `unexported`. Default when omitted:
  `["exported"]`. Every symbol is classified as exactly one of the two, and it
  is included when its class is in the configured set, as the Rust worker does
  with `pub` / `private`. A method's class is `exported` only when both the
  method name and the receiver or interface type name are exported
  (`ast.IsExported`); otherwise it is `unexported`. This is DocBridge endpoint
  visibility, not Go's: Go exports a method by its own name alone, but a
  method on an unexported type is not reachable from outside the package
  through that type, so DocBridge treats it as part of the unexported surface.
- Init discovery candidates are `*.go`, `cmd/**/*.go`, `internal/**/*.go`, and
  `pkg/**/*.go`, the conventional Go layout, so `vendor/` at the root is never
  matched. When deciding whether a candidate matches, discovery ignores
  `vendor/` and `testdata/` segments and `_test.go` files. The configuration
  has no `exclude` and no glob negation, so the generated patterns still scan
  `_test.go` files and nested `testdata/`; the user documentation says so and
  shows narrowing the positive patterns as the only remedy.

### MVP declaration set

Supported and linkable when visible:

| Declaration                        | Symbol per                                 |
| ---------------------------------- | ------------------------------------------ |
| Package-level `func` (no receiver) | function                                   |
| Method with receiver               | method                                     |
| Interface method                   | method signature inside `type X interface` |
| Package-level `type`               | `TypeSpec`, grouped or not, alias or not   |
| Package-level `const` and `var`    | name inside a `ValueSpec`, grouped or not  |

A type alias `type A = B` emits only `A`; no methods are synthesized for it. A
type whose underlying type is an interface literal, parenthesized or not,
exposes its declared methods.

Methods carry no `isMember`, following Rust: an exported, visible method that
lacks `@doc` is an `undocumented_symbol` in audit mode, for both receiver and
interface methods.

Skipped without a symbol (never `undocumented_symbol`):

- the blank identifier `_` in any position;
- `func init()`, which a file may declare more than once and which nothing can
  reference;
- struct fields and embedded fields;
- the `package` clause and `import` declarations;
- non-method interface elements: embedded interfaces, type unions, and
  approximation elements such as `~int`.

An `@doc` in the doc comment of an unsupported declaration is
`unsupported_declaration`: one diagnostic per declaration regardless of how
many annotations it holds, located at the declaration's name or, when it has
none, at its start, as the other workers report it. The worker walks every
`Doc` field the parser fills on package-level declarations and their specs,
fields, and interface elements (never inside function bodies) and treats
those not consumed by a supported declaration as unsupported: `File.Doc` (at the package name), `ImportSpec.Doc`
(at the import path), `GenDecl.Doc` of a parenthesized group (at the
keyword), a multi-name `ValueSpec.Doc` (at the first name), struct
`Field.Doc` (at the field name or the embedded type), and interface
`Field.Doc` of a non-method element (at the element). When the parser leaves
`Doc` nil for a non-method interface element, the worker recovers the comment
group that immediately precedes that element; this is the only place it looks
beyond `Doc`. Comments inside function bodies, trailing comments, and
commented-out code are ignored, matching Rust, Swift, and Dart, so a stray
`@doc` there is neither a link nor a diagnostic.

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
parentheses, and type-parameter lists (`IndexExpr`, `IndexListExpr`). Type
parameters never appear in IDs, so IDs stay stable when a type gains or loses
generics or renames a parameter. A method is unsupported when
`Recv.NumFields() != 1` (`func (a, b T) M()` is one `Field` with two names,
so the check counts names, not fields) or when the base is not a plain
identifier (for example a `C.` cgo receiver); `go/parser` accepts such
declarations, so the worker guards them rather than assuming type-correct
input.

Valid Go cannot declare a struct and an interface of the same name, but
`go/parser` accepts `type T interface{ M() }` next to `func (T) M()`, which
yields two `T.M` symbols. The worker tracks endpoints per file as the Rust
worker does: when a second annotated declaration exposes an endpoint already
taken, it emits `duplicate_code_symbol` itself and drops that symbol, since
the resolver does not deduplicate. A type named like its own method (`type T` with `func (T) T()`) is
`T` and `T.T`, which do not collide. Methods declared for one type across
several files stay distinct because the file path is the endpoint namespace.

### Doc comments and grouped declarations

Go attaches a doc comment to the declaration it immediately precedes, and the
parser exposes that association: `FuncDecl.Doc`, `GenDecl.Doc`,
`TypeSpec.Doc`, `ValueSpec.Doc`, and `Field.Doc` for interface methods. The
scanner reads only these `Doc` groups; trailing line comments
(`ValueSpec.Comment`) and comments inside bodies are never doc comments.

`@doc\s+(\S+)` is matched against the comment body taken from the original
source, not from `ast.Comment.Text`: `go/scanner` strips carriage returns from
comment literals, so `Text` cannot supply offsets for CRLF files. For each
`*ast.Comment` the worker starts at the `Slash` offset, skips the `//` or `/*`
delimiter, and ends at the end of the line or before the closing `*/`, so a
target directly followed by `*/` does not absorb the delimiter. Offsets into
the original content give the link `location`. `//go:` directive lines never
carry `@doc`.

Grouped declarations follow these rules:

- Ungrouped `const X = 1` / `var X T` / `type X T`: the parser stores the
  comment in `GenDecl.Doc`, and it belongs to the single spec.
- Parenthesized group, per-spec comment (`ValueSpec.Doc` / `TypeSpec.Doc`):
  the comment belongs to that spec.
- Parenthesized group, group-level comment (`GenDecl.Doc` above `const (`):
  the comment documents the group, which has no name, so an `@doc` in it is
  `unsupported_declaration` at the keyword. This holds even when
  the group contains a single spec, so the rule does not change when a second
  spec is added. It diverges from `go/doc`, which can fall back to the group
  comment for an undocumented spec; DocBridge needs one endpoint per
  annotation, so the fallback is not adopted.
- A `ValueSpec` with several names (`var a, b int`): every name is a symbol.
  An `@doc` in that spec's comment is `unsupported_declaration` located at
  the first name, because the annotation cannot say which name it documents.
- `iota` blocks need no special handling: every line is its own `ValueSpec`.

These rules mean an `@doc` is either attached to exactly one symbol or
reported; it is never silently duplicated onto several endpoints. When
splitting a spec would change semantics (`iota` sequences, multi-value
initializers such as `a, b := f()`), the documented alternative is a Markdown
`@code` backlink or a `docbridge.links.json` entry for the individual name.

### Positions and ranges

`token.File.Offset` converts every `token.Pos` to a byte offset, and the worker
converts byte offsets to 1-based UTF-16 columns with end-exclusive ranges, as
the other workers do. `//line` directives are ignored: line and column are
derived from the content, never from `token.Position`.

- `location` and `nameRange`: the identifier (`Ident.Pos()`..`Ident.End()`).
- `declarationRange`: from the start of the doc comment when present,
  otherwise the declaration start, to the declaration end. For a spec inside a
  group this is the spec's own range (plus its own doc), not the group's.
- `signatureRange`: for `func` and methods, from the doc comment (or `func`)
  to `FuncType.End()`, excluding the body; for interface methods, from
  `Field.Doc.Pos()` when present (`Field.Pos()` excludes the doc) to
  `Field.End()`; for other declarations, equal to `declarationRange`.

### Parse errors

Any error from `parser.ParseFile` makes the file a `code_parse_error`, with
no symbols for that file, matching the other workers' contract established by
the scanner-conformance `parse-error` case. The partial AST that `go/parser`
returns on error is discarded. The reported position is the error with the
smallest `Pos.Offset` in the `scanner.ErrorList`, converted through the
worker's own offset conversion: the list is sorted by `//line`-adjusted
positions with byte columns, so its first entry and its `Position` fields are
not usable directly. The diagnostic names the request file path, not the
`//line`-adjusted filename.

### Executable

- Name: `docbridge-go-scanner`
- Layout: `packages/go-scanner/go.mod`, `cmd/docbridge-go-scanner/main.go`
  (stdin/stdout only), `internal/scanner/` (parsing, ranges, ID rules) with
  table-driven `_test.go` files.
- Build output: `packages/go-scanner/bin/docbridge-go-scanner`. Go has no
  debug/release split, so the executable resolver gets one source candidate
  before the `dist/bin/<platform>/` fallback, and the worker-conformance test
  points at that single path.
- Build: `CGO_ENABLED=0 go build -trimpath` for reproducible, portable static
  binaries. The release matrix builds natively on each runner like the other
  workers; cross-compilation is not used so the matrix stays uniform.
- Toolchain: `go.mod` records a full patch version (`go 1.N.P`). The `go`
  directive is a minimum, and the default `GOTOOLCHAIN=auto` would download a
  newer toolchain on a mismatch, so every recipe and workflow step sets
  `GOTOOLCHAIN=local`. `local` only stops the switch; a newer installed
  compiler would still build, so a `check-go-toolchain` recipe compares
  `go env GOVERSION` with the directive and is a prerequisite of every Go
  build, lint, and test recipe (and therefore of `just verify`) and of the CI
  Go steps, not an optional `doctor` hint. The Nix dev shell adds `pkgs.go`;
  `flake.lock` pins nixpkgs, so
  the version only moves when the lock is updated, and updating the lock
  includes updating `go.mod`. Outside Nix, the workflows use `actions/setup-go`
  with `go-version-file: packages/go-scanner/go.mod`, which installs that exact
  version. Pick the version nixpkgs-unstable provides at implementation time.
- Quality recipes: `format-check-go` fails when `gofmt -l` prints any path
  (its exit status does not reflect differences) or exits non-zero, over the
  worker and `examples/go/`; `go vet ./...` for lint; `go test ./...` for
  tests. No third-party linters.

### Editor and rendering

- Context fence and hover fence language: `go`.
- Go block comments do not nest, so `go` stays out of the LSP
  `NESTED_BLOCK_COMMENTS` set.
- VS Code activation event `onLanguage:go` and document selector
  `{ scheme: "file", language: "go" }`.

## Slices

The scanner-conformance corpus requires fixtures and a runnable worker for
every entry in `KNOWN_CODE_LANGUAGES`, so registration cannot land before the
worker. An unregistered package cannot break the corpus, so the worker lands
first on its own and registration follows with the fixtures.

### Slice 1: Go scanner worker

- Create `packages/go-scanner/` per [Executable](#executable) and implement
  the protocol, MVP declarations, visibility, canonical IDs, the
  grouped-declaration rules, and the unsupported-declaration rules with
  table-driven tests covering each row of the tables above plus: CRLF block
  comments, a target followed directly by `*/`, `//line` directives before a
  syntax error, grouped and separate multi-receiver parameters, `C.`
  receivers, an interface and receiver method sharing `T.M`, aliases,
  embedded interfaces, `@doc` inside a body and in commented-out code
  (ignored), and each visibility set (omitted, empty, each singleton, both).
- Add `just` recipes: `check-go-toolchain`, `format-check-go`, `lint-go`,
  `test-go-scanner`, `build-go-scanner`; fold into `format`, `format-check`,
  `lint`, `build-test-scanners`, and `doctor`. Add `pkgs.go` to `flake.nix`.
- CI: install Go, run the toolchain check, build and test the worker.

### Slice 2: Registry, schema, adapter, and conformance fixtures

- Extend `CodeLanguage` and `KNOWN_CODE_LANGUAGES`.
- Config maps: suffix `.go`, visibility `exported` | `unexported`, init
  candidates and the Go discovery exclusion rule, context and hover fence
  `go`.
- Update `schemas/docbridge.schema.json` (`goEntry`),
  `scanner-worker.schema.json`, `common-output.schema.json`,
  `graph-output.schema.json`, `context-output.schema.json`.
- Register the worker adapter, the executable name, and the source-checkout
  candidate path; pass `--go` to `stage-scanner-binaries` in CI.
- Worker-conformance entry and the four `test-fixtures/scanner-conformance/*/go/`
  cases; unit tests for config validation, discovery, and executable
  resolution.

### Slice 3: End-to-end integration

- `examples/go/` with `go.mod`, `docbridge.config.json`, source under
  `internal/`, and `docs/*.md`, exercising a function, a type, a receiver
  method, an interface method, and a grouped const.
- `go-integration.test.ts` covering `check`, `context`, graph output, LSP
  navigation and hover, and the link manifest.
- `include.code.go` entries in the diagnostic fixtures that enumerate every
  language; an `unsupported_declaration` fixture case for a group-level `@doc`.
- Spec updates: scanning (new "Go Scanning" section and the worker
  paragraph), configuration, annotations, diagnostics, LSP language lists;
  refresh the self-audit baseline for the new heading.

### Slice 4: Release readiness

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
| `include.code.go` valid; non-`.go` rejected; exported-only default    | 2     |
| Worker implements schemaVersion 1 and builds/tests via `just`         | 1     |
| MVP declarations and both comment forms produce protocol output       | 1     |
| Canonical IDs and visibility covered by table-driven tests            | 1     |
| `code_parse_error`, `code_scanner_*`, invalid/duplicate link behavior | 1–3   |
| `examples/go/` passes check, context, graph, and LSP coverage         | 3     |
| Specs and user docs describe the Go contract                          | 3–4   |
| CI builds/tests the worker; release stages, checksums, smoke-tests it | 1, 4  |
| Existing languages keep passing `just verify`                         | 1–4   |
