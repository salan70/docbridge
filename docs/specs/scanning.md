# Scanning

DocBridge scans files matched by `include.code` and `include.docs`.

File matching is case-sensitive on every platform.

DocBridge ignores these paths even when they match an include glob:

- `node_modules`
- `.git`
- any path segment that starts with `.`
- symlink files and symlink directories

DocBridge does not read `.gitignore`.

Code files belong to a configured language: TypeScript `.ts` files (declaration
files ending in `.d.ts` are excluded), Swift `.swift` files, and Dart `.dart`
files. Each code file is scanned by its language adapter.

Markdown files are `.md` files.

If a scan target cannot be read, DocBridge emits `file_read_error`. Config file read or parse failures use `config_file_invalid` instead.

If a code file has syntactic parse errors, DocBridge emits `code_parse_error` and does not extract links or symbols from that file. Other files continue to be scanned.

When a file has `file_read_error`, `code_parse_error`,
`code_scanner_unavailable`, or `code_scanner_failed`, derived link diagnostics
that depend on that file are suppressed.

<!-- @code src/core/code-scanner.ts#CodeScanResult -->
<!-- @code src/core/code-language.ts#resolveScannerWorkerCommand -->

## Code Scanning

Code scanning is language-aware but not language-specific. Every code language
adapter, in-process (TypeScript) or worker-backed (Swift, Dart), produces the
same language-neutral result: the supported symbols, the undocumented symbols
used by audit mode, the `@doc` links, and any scanner diagnostics. The resolver,
graph, context command, and LSP consume this shared shape so a new language can
be added without changing them.

Worker-backed scanners receive one JSON request on stdin and return one JSON
response on stdout. The request contains schema version `1`, a request ID, the
language, the absolute project root, the file path/content pairs to scan, and
language options such as visibility. Stderr is treated as debug/error text and
does not affect stdout JSON parsing.

If a configured worker cannot be started, DocBridge emits
`code_scanner_unavailable`. If the worker starts but exits unsuccessfully,
returns invalid JSON, or returns a response whose schema version, request ID, or
language does not match the request, DocBridge emits `code_scanner_failed`.
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
`just test-dart-scanner` or `just build-dart-scanner` locally to build it before
checking Dart projects from a source checkout. In the npm package, the adapter
executes `dist/bin/<platform>/docbridge_dart_scanner`. Building the package
requires the Dart SDK, which the Nix dev shell provides.

The initial npm package supports scanner binaries for `darwin-arm64` and
`linux-x64`, where the platform key is `${process.platform}-${process.arch}`.
TypeScript and Markdown checks do not require scanner binaries. If a configured
Swift or Dart project runs on any other platform, or the expected binary is not
present for a supported platform, DocBridge emits `code_scanner_unavailable`
with the missing platform key and the supported keys.

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

<!-- @code src/core/glob.ts#collectFiles -->

## File Collection

File collection walks the project root, applies the ignore rules above, and
returns the managed files for each include pattern.

<!-- @code src/core/markdown.ts#scanMarkdown -->

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

<!-- @code src/core/typescript.ts#scanTypeScript -->

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

Members are never reported as `undocumented_symbol`. They are linkable, not
required to be documented, so member scanning does not change
[`check --audit`](diagnostics.md) output.

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
