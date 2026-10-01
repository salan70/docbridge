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

Code files belong to a configured language: TypeScript `.ts`, `.tsx`, `.mts`,
and `.cts` files (declaration files ending in `.d.ts`, `.d.mts`, or `.d.cts` are
excluded), Swift `.swift` files, Dart `.dart` files, Rust `.rs` files, Go `.go`
files, JavaScript `.js`, `.jsx`, `.mjs`, and `.cjs` files, Python `.py` files,
and Ruby `.rb` files. Each code file is scanned by its language adapter.

Markdown files are `.md` files.

If a scan target cannot be read, DocBridge emits `file_read_error`. Config file read or parse failures use `config_file_invalid` instead.

If a code file has syntactic parse errors, DocBridge emits `code_parse_error` and does not extract links or symbols from that file. Other files continue to be scanned. The diagnostic points at the earliest error the language's parser reports and carries that parser's message; line 1, column 1 is used only when the parser reports no position. The message wording differs by language.

When a file has `file_read_error`, `code_parse_error`,
`code_scanner_unavailable`, or `code_scanner_failed`, derived link diagnostics
that depend on that file are suppressed.

<!-- @code src/model/scan-result.ts#CodeScanResult -->
<!-- @code src/scan/code/adapter.ts#CodeLanguageAdapter -->
<!-- @code src/scan/code/worker/scanner-executable.ts#resolveScannerWorkerCommand -->
<!-- @code src/scan/code/worker/runtime-worker.ts#resolveRuntimeWorkerCommand -->

## Code Scanning

Code scanning is language-aware but not language-specific. Every code language
adapter, in-process (TypeScript and JavaScript) or worker-backed (Swift, Dart,
Rust, Go, Python, and Ruby), produces the same language-neutral result: the supported symbols, the undocumented symbols
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
and actual TypeScript, Swift, Dart, Rust, Go, Python, and Ruby scan results are
checked against it.

A scan invokes each worker-backed language once. The request carries every
readable managed file of that language in collection order. A file that cannot
be read is reported as `file_read_error` and left out of the request, and a
language without a readable file starts no worker. The scan result keeps
collection order across languages, with each read failure at its file's
position. The request is not capped. A scan holds the content of every readable
managed code file in memory until its language's request completes, plus one
serialized copy of the request while the worker runs.

Each invocation may run for 30 seconds plus 1 second per requested file; a
worker still running then is killed. Stdout and stderr together may carry up
to 1 GiB; a worker that writes more fails and may be killed before it finishes.
The CLI waits for each invocation. The Language Server runs the same request in
the background and kills the worker when the scan is cancelled; see
[LSP](lsp.md#rescan-scheduling).

A worker is killed with `SIGKILL`, which it cannot ignore. The Language Server
starts each worker in its own process group on POSIX systems and kills the whole
group, so processes the worker started, such as a runtime behind a wrapper
script, die with it; on Windows it kills only the worker process. The CLI kills
only the worker process on every platform, so a process the worker started may
outlive it. Neither waits on such a process: the CLI returns at the time limit,
and the Language Server settles at most half a second after the kill, even
while such a process still holds the worker's output open.

If a configured worker cannot be started, DocBridge emits
`code_scanner_unavailable`. If the worker starts but exits unsuccessfully, is
killed by a signal, outlives its time limit, exceeds its output limit, returns
invalid JSON, or returns a response whose schema version, request ID, or
language does not match the request, DocBridge emits `code_scanner_failed`.
Responses with missing, mistyped, or unexpected nested fields also emit
`code_scanner_failed` rather than being consumed as incomplete scan data.
Worker responses must contain exactly the requested file paths in request order;
missing files, unexpected files, or reordered files are `code_scanner_failed`.

A failure that leaves a request without a usable response applies to every file
in the request. Each file gets an empty scan result and its own copy of the
diagnostic, targeted at that file, so link diagnostics that depend on any of
those files are suppressed as for a file that failed alone.

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
TypeScript, JavaScript, and Markdown checks do not require scanner binaries, and
Python and Ruby need a language runtime instead, as described below. If a
configured Swift, Dart, Rust, or Go project runs on any other platform, or the
expected binary
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

Python and Ruby are scanned by runtime-backed workers, and the Java worker is
resolved and run the same way once Java is registered. Each is a script or JAR that runs on a language runtime found on
the machine instead of a bundled binary, so it is not platform-gated and runs
wherever its runtime runs, Windows included. Its entrypoint is under
`packages/` in a source checkout (the Java JAR needs `just build-java-scanner`
first) and under `dist/workers/<language>/` in the npm package. The command is
the runtime argv followed by fixed flags and the entrypoint, and the listed
variables are removed from the worker's environment because each can load code
or options into the runtime before the entrypoint runs. On Windows, where
variable names ignore case, each is removed in any letter case:

| Language | Runtime floor              | Flags before the entrypoint                                  | npm package entrypoint                            | Removed variables                                             |
| -------- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| Python   | CPython 3.10               | `-I -S`                                                      | `dist/workers/python/docbridge_python_scanner.py` | `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, `PYTHONSAFEPATH` |
| Ruby     | CRuby 3.3 with Prism       | `--disable=gems,did_you_mean,error_highlight -W0`            | `dist/workers/ruby/bin/docbridge-ruby-scanner`    | `RUBYOPT`, `RUBYLIB`, `PRISM_FFI_BACKEND`                     |
| Java     | JDK 17 with `jdk.compiler` | `-Xshare:auto -XX:TieredStopAtLevel=1 -XX:+UseSerialGC -jar` | `dist/workers/java/docbridge-java-scanner.jar`    | `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, `_JAVA_OPTIONS`      |

The runtime argv comes from configuration, an environment variable, or the
documented candidates, in the order that
[Scanner Runtimes](configuration.md#scanner-runtimes) defines. Before using a
runtime, DocBridge runs the full command with `--probe` in the same stripped
environment and reads the one JSON line the worker prints (see each language's
section). The probe is limited to 10 seconds and to 64 KiB of stdout and
stderr together; a probe still running after 10 seconds is killed with
`SIGKILL`, which it cannot ignore. The CLI waits for each probe. The Language
Server runs it in the background, the way it runs a worker: the probe starts
in its own process group on POSIX systems, the time and output limits kill the
group, and cancelling the scan kills the probe at once, so the server keeps
answering while a slow runtime starts. Its result is cached for the rest of
the CLI process or language server session, keyed by the full command and the
values of `PATH` and every `DOCBRIDGE_*` variable; a configuration change
clears the cache. A cancelled probe caches nothing.

A missing bundled entrypoint, a runtime that cannot be started, and a probe
that answers `ok: false`, reports another runtime, or reports a version below
the floor are `code_scanner_unavailable`, naming the runtime, the floor, and
what was found. A probe that exits unsuccessfully, is killed, times out,
exceeds the output limit, or prints anything but the expected JSON line is
`code_scanner_failed`. When no candidate is usable, the message lists each
candidate's outcome and takes its code from the first candidate that started.
The scan itself then follows the worker protocol rules above.

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
`@doc` annotations using the TypeScript Compiler API. It reads `.ts`, `.tsx`,
`.mts`, and `.cts` files, with the parser's script kind taken from the suffix,
so JSX parses in `.tsx` files only.

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

<!-- @code src/scan/code/typescript.ts#scanTypeScript -->

## JavaScript Scanning

JavaScript scanning reuses the TypeScript scanner in process. The `javascript`
language claims `.js`, `.jsx`, `.mjs`, and `.cjs` files, and the `typescript`
language additionally claims `.tsx`, `.mts`, and `.cts` files while excluding
`.d.ts`, `.d.mts`, and `.d.cts` declaration files. The parser's script kind
follows the suffix (`JS`, `JSX`, `TS`, `TSX`), so JSX in a declaration parses
without configuration. As in the TypeScript compiler, every JavaScript suffix
accepts JSX, not only `.jsx`.

A JavaScript file is also held to the TypeScript compiler's JavaScript
grammar. Syntax that only TypeScript allows, such as an `interface`, a `type`
alias, an `enum`, a type annotation, or an `implements` clause, is a syntax
error even though the parser accepts it. The first such error, with the
compiler's message, is a `code_parse_error` like any other syntax error, and a
parser error, when the file has one, is reported instead. JSDoc types are
comments and stay valid. TypeScript files are not affected.

Supported JavaScript declarations are the ESM `export` forms the TypeScript
scanner supports and the members of exported classes, with the same JSDoc
attachment, canonical IDs, ranges, duplicate handling, and diagnostics as
[TypeScript Scanning](#typescript-scanning). Scan results and diagnostics
report `language: "javascript"`, and diagnostic messages name JavaScript.

CommonJS assignments (`module.exports = ...`, `exports.name = ...`), script
globals, and JSDoc `@typedef` declarations are not endpoints; an `@doc` on
`module.exports` is `unsupported_declaration`.

The visibility contract is the TypeScript one: `public`, `protected`, and
`private` are accepted and `["public", "protected"]` is the default. JavaScript
members carry no modifier, so every member classifies as `public`; `#private`
names are unsupported as in TypeScript.

Context and hover fences follow the suffix: `js`, `jsx`, `ts`, and `tsx`.

## Python Scanning

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
pair does, is one endpoint whose `location` and ranges are the first
declaration's. Endpoints are tracked per file by canonical ID, so this holds
for classes too: the second `class C` is a repeat of the endpoint `C`, and the
members of both bodies merge into one set of member endpoints, so `f` defined
in each body is the single endpoint `C.f` and the second definition is a
repeat of it. The endpoint is documented when any of its declarations
carries `@doc`, and its links come from the first annotated declaration. As
in the Go, Ruby, and Java workers, when more than one declaration of the
endpoint in a file is annotated, exactly one `duplicate_code_symbol` is
reported for it, at the name of the first annotated repeat; further annotated
repeats are dropped without a diagnostic, and no repeat contributes links or
link diagnostics. Unannotated repeats are silently subsumed.

Python canonical IDs are dot-qualified names: `login`, `Client.login`, and
`Outer.Inner.login`. Members carry no `isMember`, so a public method without
`@doc` is an `undocumented_symbol` in audit mode, as in Go.

Some definitions of one name form a group, which counts as a single
declaration of the endpoint. The definitions of an endpoint are read in source
order; each one joins the endpoint's latest declaration when that declaration
is an open group that accepts it, and otherwise starts the endpoint's next
declaration. A group is one of:

- A property chain. A function decorated with `property`,
  `cached_property`, `@<name>.getter`, `@<name>.setter`, or `@<name>.deleter`,
  where `<name>` is that function's own name, opens it, and every later
  function of the same name decorated with one of those accessors joins it.
  A property's getter, setter, and deleter are therefore one declaration of
  `Container.<name>`, including when the chain starts at an accessor, as it
  does for a property bound by assignment (`x = property(...)`) and then
  extended with `@x.getter` and `@x.setter`.
- An overload group. A function decorated with `overload` opens it, each
  following function of that name decorated with `overload` joins it, and the
  first following function of that name not decorated with `overload` joins
  it as the implementation and closes it. Without an implementation the group
  is the stubs alone.

`property`, `cached_property`, and `overload` are recognized by the last
segment of a `Name` or `Attribute` decorator (`functools.cached_property`,
`typing.overload`), and an accessor by an `Attribute` decorator on a plain
`Name` (`value.setter`). A `Call` decorator such as `@property()` never
groups.

Every other definition of the name starts the endpoint's next declaration:
an ordinary function, a class, an accessor decorated with another name
(`@other.setter`), a second `property` getter, and any definition after an
overload group's implementation. It closes the open group without joining
it, may open a group of its own, and is a repeat of the endpoint under the
same-name rule above. An `overload` stub followed by two implementations is
thus a group of the stub and the first implementation, then a repeat.

A group's `location`, `nameRange`, `declarationRange`, and `signatureRange`
are the first member's. Annotations from every member attach to the group
endpoint in source order, the same target twice across members is
`duplicate_link`, and the group is documented when any member is. When a
group is the first annotated repeat, its `duplicate_code_symbol` is reported
at its first annotated member.

Annotations come from two sources, searched with `@doc\s+(\S+)`, where
whitespace is the ASCII set: space, tab, LF, CR, FF, and VT. Any other
character, including a Unicode space such as U+00A0, neither separates `@doc`
from its target nor ends a target, so `@doc` followed by U+00A0 is no
annotation and a U+00A0 inside a target is part of that target:

- The docstring: the first statement of the `def` or `class` body when it is a
  string expression whose value is a `str` constant, as CPython defines a
  docstring. An f-string, a concatenation that contains one, and a bytes
  literal are not docstrings. A docstring may be parenthesized or implicitly
  concatenated from several literals; the body of each literal, with its
  prefix (`r`, `u`, `R`, or `U`) and its single or triple quote delimiters
  excluded, is searched on its own. A target therefore ends before a closing
  `"""` or `)` and never continues into the next literal, and the brackets,
  comments, and whitespace between literals are never searched. Positions
  come from the source text, never from `ast.get_docstring()`, so escapes and
  indentation do not move them.
- The leading comment block: the contiguous run of comment-only lines that
  ends on the line directly above the first decorator, or above the `def` /
  `class` keyword when there is none, where every line's `#` starts at the
  declaration's column. Each line is searched after its `#`. A blank line, a
  code line, or a comment at another column ends the block. A comment between
  decorators, a trailing comment on the header line, a comment inside a body,
  and a comment block that leads nothing are never doc comments.

A link's `location` and `targetRange` cover the target text. A target that
does not parse as `file#fragment` (exactly one `#`, no empty part, no ASCII
whitespace, no backslash, no `./`, `../`, or absolute path, not the source
file itself) is `invalid_link_target`; a U+00A0 inside a target does not make
it invalid.

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

The worker is a Ruby script, not a compiled binary. It runs on the project's
CRuby, 3.3 or later, and parses with Prism, the parser gem bundled with CRuby
since 3.3. The core starts it as
`ruby --disable=gems,did_you_mean,error_highlight -W0 <path to bin/docbridge-ruby-scanner>`
with `RUBYOPT`, `RUBYLIB`, and `PRISM_FFI_BACKEND` removed from the child
environment. With RubyGems disabled, `require "prism"` resolves only from the
runtime's own library directories, where a default gem is installed, so user
and site gem paths are never searched and project code is never loaded. The
script adds its own `lib/` to the load path itself. Started with `--probe`, it
prints one JSON line, `{"ok": true, "runtime": "cruby", "version": "3.4.9",
"prism": "1.5.2"}` or `{"ok": false, "reason": "..."}` for another engine, a
version below 3.3, or a Prism that does not load, and exits 0 either way.
CRuby 3.3 bundles Prism 0.19 and 3.4 bundles 1.x; the node API differs between
them, so every version-sensitive accessor is isolated in
`lib/docbridge_ruby_scanner/compat.rb` and the suite runs on both.

The scanner is syntactic: it parses each file in isolation with
`Prism.parse(content, filepath:)` and never evaluates code, so `require`,
`include`, metaprogramming, and Rails autoloading do not affect the result.

Supported Ruby declarations are:

- `class` and `module`, at the top level and nested in class or module
  bodies
- instance methods (`def name`), singleton methods (`def self.name`, and
  `def name` inside `class << self`), and top-level methods
- constant assignments (`NAME = ...` and `Path::NAME = ...`)

Declarations are collected from the top level and from the direct statements
of class, module, and `class << self` bodies, including a body with a
`rescue` or `ensure` clause. Nothing inside a method body, a block
(`included do ... end`, `Class.new do ... end`), or control flow (`if`,
`unless`, `case`) is a declaration, so an `@doc` there is neither a link nor a
diagnostic.

Ruby canonical IDs use `::` between constants and `.` before a method name:
`login` (top-level method), `Foo`, `Foo::Bar`, `Foo::Bar::VALUE`,
`Foo::Bar.baz` (instance method), and `Foo::Bar.self.baz` (singleton method,
whether written `def self.baz` or inside `class << self`). Operator and
setter methods keep their Ruby name (`Foo.==`, `Foo.token=`). A top-level
`def self.x` is `self.x`. The `symbolName` is the last segment.

Qualification is lexical. `class Foo::Bar` inside `module A` is `A::Foo::Bar`
and `Baz::PATH = 1` inside it is `A::Foo::Bar::Baz::PATH`, regardless of
where Ruby would resolve `Foo` at run time. A leading `::` resets to the top
level: `class ::Top` inside `module A` is `Top`. A constant path whose parent
is not a constant (`self::X = 1`, `class obj.klass::Y`) is dynamic and
unsupported.

A class or module reopened in the same file is one container: its symbol and
ranges come from the first declaration, the `@doc` annotations of every
reopening attach to it in source order, and the same target repeated across
reopenings is `duplicate_link` at the repeated annotation. Reopenings in other
files stay separate endpoints. A method or constant declared twice in one
container follows the shared duplicate rule: the first annotated declaration
owns the endpoint, its location, and its links; the first repeated annotated
declaration reports one `duplicate_code_symbol` at its name, and further
annotated repeats are dropped without another diagnostic. Repeats contribute
no links. An endpoint that any declaration documents is never also
undocumented; when none does, it is reported once as undocumented, at its
first declaration.

The annotation source is the contiguous run of full-line `#` comments that
ends on the line directly above the declaration, indented or not; a blank
line, a code line, or a trailing comment after code (`X = 1 # ...`) breaks the
run, and `=begin`/`=end` blocks are never a source. Magic comments such as
`# frozen_string_literal: true` need no special case because they carry no
`@doc`. The run above `private def x` or `private_class_method def self.x`
attaches to that method. `@doc\s+(\S+)` is matched over the text after `#`,
where `\s` is the ASCII whitespace set (space, tab, LF, CR, FF, and VT) and
`\S` is any other character, so a no-break space (U+00A0) after `@doc` does
not start a link. A link's `location` and `targetRange` cover the target
text, and an invalid target is `invalid_link_target` under the
[link resolution](link-resolution.md) rules. Comments inside method bodies
are ignored.

Visibility classes are `public`, `protected`, and `private`. Classes,
modules, and constants are always `public`. A method's class is tracked
lexically within one body:

- A bare `private`, `protected`, or `public` call (no receiver, no
  arguments) switches the default for later instance `def`s in the same body.
  It never affects `def self.x`; inside `class << self` it applies to that
  block's singleton methods. Each class, module, or `class << self` body,
  including every reopening, starts at `public`.
- `private def x` and `private :x, "y"` (and the `protected`/`public` forms)
  apply to the named instance methods; the symbol or string form applies to
  the methods of that name already declared in the container, including in an
  earlier reopening in the same file.
- `private_class_method :x` and `private_class_method def self.x` (and
  `public_class_method`) apply to the named singleton methods.
- A call with a receiver (`self.private`) or inside a method body is ignored.
  `module_function` and `protected`/`private` applied through other means are
  not tracked.

`include.code.ruby.visibility` selects the classes to emit and defaults to
`["public"]`; an empty list emits nothing. An `@doc` on a declaration
excluded by the filter is `unsupported_declaration`, as in TypeScript.

Ranges follow the shared contract. `location` and `nameRange` cover the
constant or method name (`baz` in `def self.baz`). `declarationRange` starts
at the first `#` of the attached comment block, else at the `class`, `module`,
or `def` keyword (the constant for an assignment), and ends after `end`, the
endless-method expression, or the assigned value. `signatureRange` starts
where `declarationRange` starts and ends after the closing parenthesis, after
the last parameter when there are no parentheses, or after the name when
there are no parameters; for classes, modules, and constants it equals
`declarationRange`. A member's ranges start at its own indentation.

These are not symbols and report one `unsupported_declaration` when their
comment block carries `@doc`, located at the name, or at the start when they
have none: `attr_reader`, `attr_writer`, and `attr_accessor` (at the call
name), `alias` (at the new name) and `alias_method`, `define_method`, a
singleton method on a receiver other than `self` (`def obj.x`, and every
method inside `class << obj`), a dynamic constant path, a `class << self`
block itself, and a class, module, or constant declared inside
`class << self`. Other constant forms (`X ||= 1`, `A, B = 1, 2`) and every
other statement are ignored. Methods carry no `isMember`, so a public method
without `@doc` is an `undocumented_symbol` in audit mode, as in Go.

Byte offsets from Prism are converted to 1-based UTF-16 columns over the
original content, so CRLF files, a UTF-8 byte order mark (which counts as one
column on line 1, as in the other workers), and non-ASCII identifiers and
comments keep their positions.

A syntax error makes the file a `code_parse_error` with no symbols; the
reported position and message come from the error with the smallest byte
offset, and the recovered tree is discarded. Prism's messages differ between
0.19 and 1.x, so the message wording depends on the installed runtime.

## Java Scanning

Java scanning is pending registration: the `java` language ID is
not accepted by configuration yet. The worker under `packages/java-scanner`
implements the contract below, and its conformance cases live under
`test-fixtures/pending-languages/java/` until registration moves them into
the corpus. The pending configuration, annotation, and diagnostic contracts are in
[Configuration](configuration.md#code-languages),
[Annotations](annotations.md), and [Diagnostics](diagnostics.md).

Java scanning extracts `@doc` annotations from the Javadoc comment
(`/** ... */`) that documents a declaration. The worker is a JAR built from
`packages/java-scanner` with `javac --release 17` and `jar` alone, no Maven,
Gradle, or third-party library, and it runs on the project's own JDK rather
than on a bundled binary. It parses with the public `com.sun.source` tree API
of the `jdk.compiler` module: `ToolProvider.getSystemJavaCompiler().getTask()`
with the options `-proc:none -implicit:none -Xlint:none`, no classpath, a
diagnostic listener, and an in-memory source per file, calling only `parse()`
and never `analyze()`, so no project code is loaded, resolved, or executed and
the internal `com.sun.tools.javac` packages are never touched. Each file is
parsed independently. The scanner is syntactic: it does not resolve types or
imports, so a parameter type is printed as written, not as the type it names.

The core starts the worker as
`java -Xshare:auto -XX:TieredStopAtLevel=1 -XX:+UseSerialGC -jar packages/java-scanner/build/docbridge-java-scanner.jar`
from a source checkout (run `just build-java-scanner` first) and removes
`JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, and `_JAVA_OPTIONS` from the child
environment so injected options cannot change the protocol output. The flags
favor start-up time over peak speed, which suits a short-lived process.
`--probe` prints one JSON line and exits 0 either way:
`{ "ok": true, "runtime": "jdk", "version": "17.0.19" }` on a JDK 17 or newer
with `jdk.compiler`, or `{ "ok": false, "reason": "..." }` when
`ToolProvider.getSystemJavaCompiler()` returns null (a JRE) or the runtime is
older than 17. The entry class alone is compiled for Java 8 so an old JVM can
still load it and answer the probe instead of failing on the class version.

By default only `public` declarations are included; `include.code.java.visibility`
may add `protected`, `package`, and `private`. A declaration's class comes from
its modifiers, with two implicit cases: members of an interface or annotation
type without an access modifier are `public`, and so are enum constants, while
an enum constructor is `private`. An endpoint's class is the least visible of
its own and every enclosing type's, so a public method of a private nested
class is `private`. An `@doc` on a declaration outside the configured classes is
`unsupported_declaration`.

Supported Java declarations are:

- top-level and member types of every kind: `class`, `interface`, `enum`,
  `record`, and `@interface`
- methods and constructors, including a record's compact constructor
- fields and enum constants; a record's components are its private final
  fields

Local classes, anonymous classes, lambdas, initializer blocks, and everything
inside a method body are not walked, so an `@doc` there is neither a link nor
a diagnostic, except that an annotated Javadoc directly before an initializer
block is `unsupported_declaration` located at the block's `static` keyword or
opening brace.

Java canonical IDs use `.` qualification through every enclosing type and a
parenthesized parameter-type list for methods and constructors: `Foo`,
`Foo.Inner`, `Foo.MAX`, `Foo.bar(int,String)`, `Foo.Foo(int)`, and
`Outer.Inner.m()`. A constructor is named after its type, so its symbol name is
the type's simple name. Symbol names and IDs use the names javac decodes:
Unicode escapes are resolved and identifier-ignorable characters such as
U+200B are dropped, so `class \u0046oo` is `Foo` and a parameter of type
`\u0046oo` prints as `Foo`. Parameter types are printed from the type tree alone:
annotations are removed (`@A int` is `int`), type arguments are removed
(`List<String>` is `List`, `Map.Entry<K, V>` is `Map.Entry`), qualified names
and type variables are kept as written (`java.util.List`, `T`), each array
dimension is `[]` whether written on the type or after the name, varargs are
arrays (`String...` is `String[]`, `String[]...` is `String[][]`), and no
whitespace or parameter names appear. A method's own type parameters do not
appear, so `<U> Foo(List<U> u)` is `Foo.Foo(List)`. Overloads that print the
same way, such as `m(List<String>)` and `m(List<Integer>)`, share one endpoint.
As in Go, the first annotated declaration keeps the endpoint and its links, the
next annotated one reports one `duplicate_code_symbol` per endpoint at its
name, and further annotated repeats are dropped without another diagnostic.

The annotation source is the Javadoc comment javac associates with the
declaration: the last `/**` comment before the declaration's first token
(its Javadoc, annotations, or modifiers), separated from it only by whitespace
and non-Javadoc comments. Of two consecutive Javadoc comments only the second
counts. `DocTrees.getDocComment` decides the association, but it returns the
comment with its formatting stripped, so the text and its positions come from
the original source. `@doc\s+(\S+)` is matched over the comment body, with
`\s` the ASCII whitespace set (space, tab, LF, CR, FF, and VT) and `\S` its
complement, so a no-break space after `@doc` yields no target. The body
excludes the `/**` and `*/` delimiters, so a target directly followed by `*/`
ends before it, and the asterisks that lead continuation lines count as
whitespace, so a target on the line after `@doc` does not absorb its `*`. A
link's `location` and `targetRange` cover the target text, and a target outside
the [link resolution](link-resolution.md) grammar is `invalid_link_target`,
including one with more than one `#`, such as `docs/a.md#one#two`. `//` and
`/* ... */` comments are never annotation sources. Projects that run `javadoc`
with `-Xdoclint` register the tag with `-tag doc:a:"DocBridge:"` so the
unknown-tag check accepts it.

Ranges follow the shared contract. A symbol's `location` and `nameRange` cover
the name identifier as spelled in the source. It is found after the
declaration's modifiers and type parameters by stepping over the element type
and type annotations of the field or return type, so dimensions written after
the name (`int xs[]`, `int[] ys[]`, `int legacy()[]`) do not hide it.
Identifiers are matched by code point against javac's decoded names, and the
ranges cover the raw spelling: `\u0046oo` is the symbol `Foo` with a
`nameRange` 8 UTF-16 code units wide. A name that still cannot be located
keeps its symbol, with `location` at the start javac reports for the
declaration and an empty `nameRange` there, rather than failing the file.
`declarationRange` starts at the Javadoc comment when the declaration has
one, else at its first annotation or modifier (or its first token), and ends
where javac ends the declaration: after the closing brace of a type or method
body, after `;` for a method without a body or the last field of a statement,
and after the initializer or the following `,` for an earlier field.
`signatureRange` shares the start and ends before the body's opening brace for
types and methods, after the last header token such as `)`, a `throws` type, or
the closing `>` of a type parameter list; for a method without a body and for
fields it equals `declarationRange`.

Offsets from `Trees.getSourcePositions` index the content in UTF-16 code units,
so columns need no conversion; lines and columns are computed from the
content's own line starts, never from javac's `LineMap`, which expands tabs. A
CRLF file keeps its `\r` inside the line, and a BOM is column 1 of line 1: javac
rejects it, so the worker parses the content without it and shifts every offset
back by one.

An `@doc` in the Javadoc of a package declaration, an import, or an initializer
block, or in a Javadoc dangling at the end of the file, reports one
`unsupported_declaration` located at the package name, the imported name, the
block's first token, or the comment itself. A field statement that declares
several names (`int a, b;`, or `int a[], b;` with dimensions on one name)
exposes every name as a symbol, but an `@doc` above it is
`unsupported_declaration` at the first name because the annotation cannot say
which name it documents, as in Go; declare the link in `docbridge.links.json`
instead. Members carry no `isMember`, so a visible method or field without
`@doc` is an `undocumented_symbol` in audit mode, as in Rust and Go. An
endpoint that any included declaration documents is never also undocumented,
whichever declaration comes first; an endpoint that none documents is reported
once, at its first declaration. Included means supported and inside the
configured visibility classes, so an annotated declaration that the filter
excludes documents nothing.

A diagnostic of kind `ERROR` from javac makes the file a `code_parse_error`
with no symbols and javac's English message; the reported position is the
error with the smallest start offset, or its preferred position when javac
reports no start, converted from the original content. `javac` accepts newer
syntax only as far as the installed JDK parses it, and preview features are
not enabled.
