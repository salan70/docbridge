<!-- @code src/query/project-scan.ts#scanProject -->

# Scanning

DocBridge scans files matched by `include.code` and `include.docs`.

After scanning, DocBridge applies the optional
[link manifest](link-manifest.md), so declared links reach every consumer as
ordinary links.

File matching is case-sensitive on every platform.

DocBridge ignores these paths even when they match an include glob:

- `node_modules`
- `.git`
- any path segment that starts with `.`
- symlink files and symlink directories

DocBridge does not read `.gitignore`.

Code files belong to a configured language: TypeScript `.ts` files (declaration
files ending in `.d.ts` are excluded), Swift `.swift` files, Dart `.dart`
files, Rust `.rs` files, and Go `.go` files. Each code file is scanned by its
language adapter.

Markdown files are `.md` files.

If a scan target cannot be read, DocBridge emits `file_read_error`. Config file read or parse failures use `config_file_invalid` instead.

If a code file has syntactic parse errors, DocBridge emits `code_parse_error` and does not extract links or symbols from that file. Other files continue to be scanned. The diagnostic points at the earliest error the language's parser reports and carries that parser's message; line 1, column 1 is used only when the parser reports no position. The message wording differs by language.

When a file has `file_read_error`, `code_parse_error`,
`code_scanner_unavailable`, or `code_scanner_failed`, derived link diagnostics
that depend on that file are suppressed.

<!-- @code src/model/scan-result.ts#CodeScanResult -->
<!-- @code src/scan/code/adapter.ts#CodeLanguageAdapter -->
<!-- @code src/scan/code/worker/scanner-executable.ts#resolveScannerWorkerCommand -->

## Code Scanning

Code scanning is language-aware but not language-specific. Every code language
adapter, in-process (TypeScript) or worker-backed (Swift, Dart, Rust, Go), produces the
same language-neutral result: the supported symbols, the undocumented symbols
used by audit mode, the `@doc` links, and any scanner diagnostics. The resolver,
graph, context command, and LSP consume this shared shape so a new language can
be added without changing them.

Every adapter reports positions the same way. Lines and columns are 1-based,
columns count UTF-16 code units, and ranges are end-exclusive. A symbol's
`location` is the start of its name. An `@doc` link's `location` is the start
of its annotation target, so link diagnostics such as `duplicate_link` point at
the annotation that caused them. `unsupported_declaration` points at the
declaration's name, or at the declaration start when it has none.

Worker-backed scanners receive one JSON request on stdin and return one JSON
response on stdout. The request contains schema version `1`, a request ID, the
language, the absolute project root, the file path/content pairs to scan, and
language options such as visibility. Stderr is treated as debug/error text and
does not affect stdout JSON parsing. The complete protocol is defined by
[schemas/scanner-worker.schema.json](../../schemas/scanner-worker.schema.json),
and actual TypeScript, Swift, Dart, Rust, and Go scan results are checked against
it.

If a configured worker cannot be started, DocBridge emits
`code_scanner_unavailable`. If the worker starts but exits unsuccessfully,
returns invalid JSON, or returns a response whose schema version, request ID, or
language does not match the request, DocBridge emits `code_scanner_failed`.
Responses with missing, mistyped, or unexpected nested fields also emit
`code_scanner_failed` rather than being consumed as incomplete scan data.
Worker responses must contain exactly the requested file paths in request order;
missing files, unexpected files, or reordered files are `code_scanner_failed`.

The bundled Swift worker is a SwiftPM package under `packages/swift-scanner`.
It uses SwiftSyntax/SwiftParser and communicates through the worker protocol.
From a source checkout, the adapter executes the built
`packages/swift-scanner/.build/release/docbridge-swift-scanner` binary, falling
back to the debug binary when present; run `just test-swift-scanner` or
`just build-swift-scanner` locally to build it before checking Swift projects
from a source checkout. In the npm package, the adapter executes
`dist/bin/<platform>/docbridge-swift-scanner`. Building the source package
requires a Swift 6 toolchain on `PATH`. The Nix dev shell deliberately omits a
C compiler (`mkShellNoCC`) so it does not export an `SDKROOT` that would shadow
the system Swift toolchain on macOS; CI installs Swift separately.

The bundled Dart worker is a Dart package under `packages/dart-scanner`. It uses
the Dart `analyzer` and communicates through the worker protocol. From a source
checkout, the adapter executes the compiled
`packages/dart-scanner/bin/docbridge_dart_scanner` binary; run
`just build-dart-scanner` locally to compile it before checking Dart projects
from a source checkout; `just test-dart-scanner` runs the package tests without
compiling the binary. In the npm package, the adapter
executes `dist/bin/<platform>/docbridge_dart_scanner`. Building the package
requires the Dart SDK, which the Nix dev shell provides.

The bundled Rust worker is a Cargo package under `packages/rust-scanner`. It uses
`syn` with `proc-macro2` span locations and communicates through the worker
protocol. From a source checkout, the adapter executes
`packages/rust-scanner/target/release/docbridge-rust-scanner`, falling back to
the debug binary when present; run `just test-rust-scanner` or
`just build-rust-scanner` locally to build it before checking Rust projects from
a source checkout. In the npm package, the adapter executes
`dist/bin/<platform>/docbridge-rust-scanner`. Building the package requires the
Rust toolchain pinned by `packages/rust-scanner/rust-toolchain.toml` on `PATH`.

The bundled Go worker is a Go module under `packages/go-scanner`. It uses the
standard library's `go/parser`, `go/ast`, and `go/token` with no third-party
dependencies and communicates through the worker protocol. From a source
checkout, the adapter executes `packages/go-scanner/bin/docbridge-go-scanner`;
Go has no debug/release split, so run `just build-go-scanner` locally to build
that single static binary before checking Go projects from a source checkout.
In the npm package, the adapter executes
`dist/bin/<platform>/docbridge-go-scanner`. Building the package requires the
exact Go version pinned by the `go` directive in `packages/go-scanner/go.mod`
on `PATH`; the recipes set `GOTOOLCHAIN=local` and fail on any other version
instead of letting Go download one.

The initial npm package supports scanner binaries for `darwin-arm64` and
`linux-x64`, where the platform key is `${process.platform}-${process.arch}`.
TypeScript and Markdown checks do not require scanner binaries. If a configured
Swift, Dart, Rust, or Go project runs on any other platform, or the expected binary
is not present for a supported platform, DocBridge emits
`code_scanner_unavailable` with the missing platform key and the supported keys.

Installers do not reliably preserve the executable bit on the scanner binaries
bundled under `dist/bin/`. When DocBridge resolves one of its own bundled
scanners and the current process cannot execute it, DocBridge restores the
executable bit itself and proceeds; callers never need to `chmod` a bundled
scanner. Repair adds execute bits only and leaves the existing read and write
bits alone, so a scanner installed owner-only stays owner-readable. Repair
applies only to the resolved DocBridge build output or packaged binary, never to
a path derived from configuration.

Repair is best-effort. When the executable bit cannot be restored — a read-only
store, for example — DocBridge emits `code_scanner_unavailable` naming the
binary path, its observed mode, and the underlying error. When the binary is
executable and the spawn is still refused with a permission error, the
filesystem itself refuses execution, which is what a `noexec` mount does;
DocBridge emits `code_scanner_unavailable` naming the binary's directory and
that cause.

<!-- @code src/shared/glob.ts#collectFiles -->

## File Collection

File collection walks the project root, applies the ignore rules above, and
returns the managed files for each include pattern.

<!-- @code src/scan/markdown/markdown.ts#scanMarkdown -->

## Markdown Scanning

Markdown scanning extracts heading anchors and `@code` annotations from a
single Markdown file.

Scanning also produces a heading outline: every ATX heading in document order,
each with its level, whether at least one `@code` comment is attached to it,
and the anchor it created. Empty headings appear in the outline with no anchor,
because they create none yet still close the section before them. Consumers
that need the document's nesting must use the outline rather than the anchors,
which cannot express a section closed by an empty heading.

The annotation flag is recorded independently of the extracted links, because
an annotation whose target fails to parse produces `invalid_link_target` and
never becomes a link, yet still counts as an attempted link for
[`unlinked_doc_section`](diagnostics.md#unlinked-doc-sections). An empty
heading is never annotated: a `@code` comment before one becomes
`dangling_code_annotation`.

<!-- @code src/scan/code/typescript.ts#scanTypeScript -->

## TypeScript Scanning

TypeScript scanning extracts exported declarations, their type members, and
`@doc` annotations using the TypeScript Compiler API.

For each supported declaration the scanner records, alongside the name range
used for navigation, a `declarationRange` covering the whole declaration
including its leading JSDoc block. The
[context command](cli.md#context-command) extracts declaration content from
this range. When the declaration starts past column 1, as a type member does,
the block's common leading indentation is stripped so the member reads at its
own level rather than its enclosing type's; a top-level declaration starts at
column 1 and is extracted verbatim.

The scanner also records a `signatureRange` for the declaration's public
surface. The signature range includes the leading JSDoc block but excludes
implementation bodies when the syntax has one, including function bodies, class
bodies, and supported variable initializers with arrow-function, function,
class, or object bodies. A member without a body, such as a property or an
interface signature, exposes its whole declaration.

<!-- @code src/scan/code/typescript.ts#scanTypeScript -->

### TypeScript Members

Scanning descends one level into every top-level `class`, `interface`, `enum`,
object type alias, and variable statement whose initializer is a class
expression. Containers are visited whether or not they are exported, so an
annotated member of a non-exported type is reported rather than ignored.

Supported TypeScript members are:

- class methods, properties, getters, setters, constructors, and static members
- interface property and method signatures
- property and method signatures of a type alias written directly as an object
  type literal

TypeScript canonical IDs are type-qualified member names without parameter
signatures, for example `AuthService.login`. Overload signatures and a
getter/setter pair each collapse to one endpoint, because they describe one
member; when two of them carry `@doc`, `duplicate_code_symbol` is emitted. A
static member and an instance member of the same name share one canonical ID
and collide the same way. The constructor is `AuthService.constructor`.

The qualifier is the container's own top-level endpoint name, so
`export const Public = class Internal {}` yields `Public.login`, and a container
without one — an anonymous default-exported class, a non-exported class — hosts
no member endpoints.

A member is an endpoint only when its name is a plain identifier. Link targets
are `file#fragment` with exactly one `#` and no whitespace in the fragment, so
private identifiers (`#secret`), string-literal names, numeric names, and
computed names cannot be expressed. These are `unsupported_declaration` when
annotated, as are enum members, index signatures, call and construct signatures,
constructor parameter properties, and members excluded by visibility.

By default, `public` and `protected` members are included; `private` members are
included only when configured through `include.code.typescript.visibility`.
Members of a union, intersection, mapped, or conditional type alias are not
visited at all, so an annotation on one is not detected.

An undocumented member is reported with `isMember` set, and the
`undocumented_symbol` rule skips flagged symbols. Members are linkable, not
required to be documented, so member scanning does not change
[`check --audit`](diagnostics.md) output. Reporting them keeps a member
addressable from a [link manifest](link-manifest.md) entry, which needs the
full set of visible endpoints rather than only the annotated ones.

## Swift Scanning

Swift scanning extracts `@doc` annotations from `///` and `/** ... */`
documentation comments. By default, `public` and `open` declarations are
included; `internal` declarations are included only when configured through
`include.code.swift.visibility`.

Supported Swift declarations are:

- top-level and member `class`, `struct`, `enum`, `protocol`, and `actor`
- top-level and member `func`, `var`, `let`, and `init`
- members declared in extensions, canonicalized as members of the extended type

Swift canonical IDs use type-qualified member names and argument labels, for
example `AuthService.login(email:password:)`, `AuthService.refresh(_:)`, and
`AuthService.init(email:password:)`.

## Dart Scanning

Dart scanning extracts `@doc` annotations from `///` and `/** ... */`
documentation comments. Only public declarations are scanned: Dart marks
library-private declarations with a leading underscore, so an endpoint is
excluded when any name segment of its canonical ID starts with `_`. A member or
constructor of a library-private type (or an extension on one) is therefore
private even when its own name is public. `include.code.dart.visibility` accepts
only `public`.

Supported Dart declarations are:

- top-level functions, getters, setters, and variables
- `class`, `enum`, `mixin`, and their members: methods, getters, setters,
  fields, and constructors
- members declared in extensions, canonicalized as members of the extended type

Dart has no method overloading, so canonical IDs are type-qualified member
names without parameter signatures, for example `AuthService.login`. Setters
carry a trailing `=` to stay distinct from a same-named getter or field
(`AuthService.token=`), the unnamed constructor is `AuthService.new`, and named
constructors keep their name (`AuthService.guest`).

## Rust Scanning

Rust scanning extracts `@doc` annotations from `///`, `//!`, and `/** ... */`
documentation comments (including docs that syn surfaces as `#[doc]` /
`#![doc]` attributes). By default only unrestricted `pub` declarations are
included; non-`pub` declarations are included when configured through
`include.code.rust.visibility` with `private`.

Supported Rust declarations are:

- `mod` (including nested modules)
- `struct` and `enum`
- free `fn`
- inherent `impl` methods (`impl Type { fn method }`)

Trait definitions, trait-impl methods, macros, const/static items, unions,
extern blocks, and other item kinds are out of the MVP set. An `@doc` on one
reports `unsupported_declaration`.

Rust canonical IDs use path-style `::` qualification, for example `normalize`,
`TypingEngine`, `TypingEngine::advance`, and `domain::typing`.

## Go Scanning

Go scanning extracts `@doc` annotations from the doc comment of a declaration,
written as `//` line comments or a `/* ... */` block comment, using the standard
library's `go/parser`, `go/ast`, and `go/token`. The scanner is syntactic: it
parses each file in isolation and does not type-check, resolve imports, or
evaluate build constraints, so `//go:build` files, `_test.go` files, and
`vendor/` directories are scanned whenever the configured patterns match them.

By default only exported declarations are included; unexported declarations are
included when `include.code.go.visibility` contains `unexported`. A method is
exported for DocBridge only when both its own name and its receiver or
interface type name are exported, because a method on an unexported type is not
reachable from outside the package through that type.

Supported Go declarations are:

- package-level `func`
- methods with a receiver
- interface methods (`type X interface { Method() }`)
- package-level `type`, including aliases, grouped or not
- package-level `const` and `var`, grouped or not

Go canonical IDs use selector-style `.` qualification: `Login`, `Server`,
`Server.Start`, and `Reader.Read`. The receiver type name is the base
identifier after unwrapping `*`, parentheses, and type parameters, so
`func (l *List[T]) Push(v T)` is `List.Push` and stays stable when the type
gains or loses generics. A method whose receiver does not name exactly one
parameter or whose base is not a plain identifier (such as a cgo `C.` type) is
unsupported.

The scanner reads only the doc comment the parser attaches to a declaration:
`FuncDecl.Doc`, `GenDecl.Doc`, `TypeSpec.Doc`, `ValueSpec.Doc`, and interface
`Field.Doc`. Trailing line comments, comments inside function bodies, and
commented-out code are never doc comments, so an `@doc` there is neither a link
nor a diagnostic. Comment text is taken from the original source with the
delimiters removed, so a target directly followed by `*/` ends before it and
CRLF files keep their positions.

Grouped declarations follow these rules:

- An ungrouped `const X = 1`, `var X T`, or `type X T` owns the comment above
  it.
- Inside a parenthesized group, the comment above a spec belongs to that spec.
- A comment above the group keyword (`// ...` before `const (`) documents the
  group, which has no name. An `@doc` there is `unsupported_declaration`,
  located at the keyword, even when the group holds a single spec. This
  diverges from `go/doc`, which can fall back to the group comment; DocBridge
  needs one endpoint per annotation.
- A spec that declares several names (`var a, b int`) exposes every name as a
  symbol, but an `@doc` above it is `unsupported_declaration` at the first name
  because the annotation cannot say which name it documents. When splitting the
  spec would change semantics (`iota` sequences, multi-value initializers),
  declare the link in `docbridge.links.json` instead. A Markdown `@code` alone
  does not work: without a matching `@doc` it is `code_backlink_not_found`.

The blank identifier `_`, `func init()`, struct fields, embedded fields, the
`package` clause, `import` declarations, and non-method interface elements
(embedded interfaces, type unions, and `~T` approximations) are not symbols
and are never `undocumented_symbol`. An `@doc` in the doc comment of any of
them reports one `unsupported_declaration` located at its name, or at its start
when it has none. Methods carry no `isMember`, so an exported method without
`@doc` is an `undocumented_symbol` in audit mode, as in Rust.

`go/parser` accepts `type T interface{ M() }` next to `func (T) M()` even
though valid Go cannot declare both. When two annotated declarations in one
file expose the same endpoint, the worker reports `duplicate_code_symbol` and
keeps the first.

A syntax error makes the file a `code_parse_error` with no symbols; the
reported position is the error with the smallest byte offset, converted from
the original content, so `//line` directives do not move it.

## JavaScript Scanning

JavaScript scanning is pending registration: the `javascript` language ID is
not accepted by configuration yet. The contract below is normative once the
adapter lands.

JavaScript scanning reuses the TypeScript scanner in process. The `javascript`
language claims `.js`, `.jsx`, `.mjs`, and `.cjs` files, and the `typescript`
language additionally claims `.tsx`, `.mts`, and `.cts` files while excluding
`.d.ts`, `.d.mts`, and `.d.cts` declaration files. The parser's script kind
follows the suffix (`JS`, `JSX`, `TS`, `TSX`), so JSX in a declaration parses
without configuration.

Supported JavaScript declarations are the ESM `export` forms the TypeScript
scanner supports and the members of exported classes, with the same JSDoc
attachment, canonical IDs, ranges, duplicate handling, and diagnostics as
[TypeScript Scanning](#typescript-scanning). Scan results report
`language: "javascript"`.

CommonJS assignments (`module.exports = ...`, `exports.name = ...`), script
globals, and JSDoc `@typedef` declarations are not endpoints; an `@doc` on
`module.exports` is `unsupported_declaration`.

The visibility contract is the TypeScript one: `public`, `protected`, and
`private` are accepted and `["public", "protected"]` is the default. JavaScript
members carry no modifier, so every member classifies as `public`; `#private`
names are unsupported as in TypeScript.

Context and hover fences follow the suffix: `js`, `jsx`, `ts`, and `tsx`.

## Python Scanning

Python scanning is pending registration: the `python` language ID is not
accepted by configuration yet. The worker under `packages/python-scanner`
implements the contract below; registration adds the suffix set and the
configuration and diagnostic paragraphs.

Python scanning extracts `@doc` annotations from docstrings and from the
comment block that leads a declaration, using the standard library's `ast` and
`tokenize` modules. The worker is runtime-backed: the core runs
`python3 -I -S packages/python-scanner/docbridge_python_scanner.py` on the
CPython interpreter it discovers (floor CPython 3.10) and exchanges one
request and one response through the worker protocol. The `--probe` mode
prints one JSON line, `{ "ok": true, "runtime": "cpython", "version": "3.13.13" }`
or `{ "ok": false, "reason": "..." }`, and exits 0 either way; a non-CPython
interpreter or one below the floor is not ok. The worker is syntactic: it
parses each file in isolation with `ast.parse(content, filename,
type_comments=False)`, never imports or executes project code, and does not
evaluate `__all__`, decorators, or conditions.

By default only `public` declarations are included; `private` declarations are
included when `include.code.python.visibility` contains `private`. A name is
private when it starts with `_` and is not a `__dunder__` name; a declaration
is private when its own name or any enclosing class name is private, so
`_Registry.register` is private even though `register` is not.

Supported Python declarations are:

- module-level `def`, `async def`, and `class`
- methods and nested classes in class bodies, recursively for classes

The walk descends into `if`, `for`, `while`, `with`, `try`, and `match`
statements at module and class level, including their `else`, `except`,
`finally`, and `case` blocks, so a declaration under `if TYPE_CHECKING:` or
`try:` is found. It never enters a function body: a nested function or class
inside one is not a symbol, and an `@doc` there is neither a link nor a
diagnostic. The same name declared twice in one container, as an `if`/`else`
pair does, is one endpoint at its first declaration; a second annotated
declaration is `duplicate_code_symbol` at its name.

Python canonical IDs are dot-qualified names: `login`, `Client.login`, and
`Outer.Inner.login`. Members carry no `isMember`, so a public method without
`@doc` is an `undocumented_symbol` in audit mode, as in Go.

Grouped declarations follow these rules:

- A function decorated with `property`, `cached_property`, `<name>.getter`,
  `<name>.setter`, or `<name>.deleter` is the endpoint `Container.<name>`, so
  a property's getter, setter, and deleter share one endpoint.
- A function decorated with `overload` shares the endpoint of its
  implementation, or of the first stub when no implementation follows.
- A decorator is recognized by the last segment of a `Name` or `Attribute`
  expression (`property`, `functools.cached_property`, `typing.overload`,
  `value.setter`); a `Call` decorator such as `@property()` never groups, so
  a second definition after one is a duplicate.
- A group's `location`, `nameRange`, `declarationRange`, and `signatureRange`
  are the first member's. Annotations from every member attach to the group
  endpoint in source order, the same target twice across members is
  `duplicate_link`, and the group is documented when any member is.

Annotations come from two sources, searched with `@doc\s+(\S+)`:

- The docstring: the first statement of the `def` or `class` body when it is a
  string expression. The search covers the string's source text with its
  prefix and quote delimiters excluded, so a target directly followed by `"""`
  ends before it. Positions come from the source text, never from
  `ast.get_docstring()`, so escapes and indentation do not move them.
- The leading comment block: the contiguous run of comment-only lines that
  ends on the line directly above the first decorator, or above the `def` /
  `class` keyword when there is none, where every line's `#` starts at the
  declaration's column. Each line is searched after its `#`. A blank line, a
  code line, or a comment at another column ends the block. A comment between
  decorators, a trailing comment on the header line, a comment inside a body,
  and a comment block that leads nothing are never doc comments.

A link's `location` and `targetRange` cover the target text. A target that
does not parse as `file#fragment` (exactly one `#`, no empty part, no
whitespace, no backslash, no `./`, `../`, or absolute path, not the source
file itself) is `invalid_link_target`.

For each symbol, `location` and `nameRange` cover the name token.
`declarationRange` starts at the leading comment block, else at the first
decorator, else at the keyword, and ends at the end of the definition.
`signatureRange` starts at the same position and ends directly after the `:`
that closes the header, so a body, including a docstring, is excluded.

The module docstring, assignments (including a `lambda` bound by one),
annotated assignments, imports, and every other statement at module or class
level are not symbols and are never `undocumented_symbol`. An `@doc` in the
module docstring, or in the leading comment block of such a statement,
reports one `unsupported_declaration` located at the statement's first token.
A supported declaration excluded by visibility is `unsupported_declaration`
at its name when annotated; for a group, each annotated member is reported at
its own name.

Positions follow the shared contract even though CPython reports three column
systems: `ast` columns are UTF-8 byte offsets, `tokenize` columns are code
point indexes, and `SyntaxError.offset` is 1-based in code points. Each is
converted to a 1-based UTF-16 column through the line's source text. Lines
split on `\n` only, so a CRLF file keeps its positions and no range includes a
line ending. A UTF-8 BOM is removed before parsing, because CPython rejects it
inside a `str`, and is counted as the first character of line 1.

A syntax error makes the file a `code_parse_error` with no symbols; the
diagnostic carries the `SyntaxError` message at its `lineno` and `offset`, or
line 1, column 1 when the exception reports no position, as a null byte does.
The message wording follows the installed CPython, which may differ between
versions for the same input. `tokenize` runs only after `ast.parse` succeeds.

## Ruby Scanning

Ruby scanning is pending registration: the `ruby` language ID is not accepted
by configuration yet. This section is filled in when the worker lands.

## Java Scanning

Java scanning is pending registration: the `java` language ID is not accepted
by configuration yet. This section is filled in when the worker lands.
