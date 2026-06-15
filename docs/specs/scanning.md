# Scanning

SpecLink scans files matched by `include.code` and `include.docs`.

File matching is case-sensitive on every platform.

SpecLink ignores these paths even when they match an include glob:

- `node_modules`
- `.git`
- any path segment that starts with `.`
- symlink files and symlink directories

SpecLink does not read `.gitignore`.

Code files belong to a configured language: TypeScript `.ts` files (declaration
files ending in `.d.ts` are excluded), Swift `.swift` files, and Dart `.dart`
files. Each code file is scanned by its language adapter.

Markdown files are `.md` files.

If a scan target cannot be read, SpecLink emits `file_read_error`. Config file read or parse failures use `config_file_invalid` instead.

If a code file has syntactic parse errors, SpecLink emits `code_parse_error` and does not extract links or symbols from that file. Other files continue to be scanned.

When a file has `file_read_error`, `code_parse_error`,
`code_scanner_unavailable`, or `code_scanner_failed`, derived link diagnostics
that depend on that file are suppressed.

<!-- @code src/core/code-scanner.ts#CodeScanResult -->
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

If a configured worker cannot be started, SpecLink emits
`code_scanner_unavailable`. If the worker starts but exits unsuccessfully,
returns invalid JSON, or returns a response whose schema version, request ID, or
language does not match the request, SpecLink emits `code_scanner_failed`.
Worker responses must contain exactly the requested file paths in request order;
missing files, unexpected files, or reordered files are `code_scanner_failed`.

The bundled Swift worker is a SwiftPM package under `packages/swift-scanner`.
It uses SwiftSyntax/SwiftParser and communicates through the worker protocol.
The adapter executes the built `speclink-swift-scanner` binary from that
package; run `just test-swift-scanner` or `just build-swift-scanner` locally to
build it before checking Swift projects from a source checkout. Building the
package requires a Swift 6 toolchain on `PATH`. The Nix dev shell deliberately
omits a C compiler (`mkShellNoCC`) so it does not export an `SDKROOT` that would
shadow the system Swift toolchain on macOS; CI installs Swift separately.

The bundled Dart worker is a Dart package under `packages/dart-scanner`. It uses
the Dart `analyzer` and communicates through the worker protocol. The adapter
executes the compiled `speclink_dart_scanner` binary from that package; run
`just test-dart-scanner` or `just build-dart-scanner` locally to build it before
checking Dart projects from a source checkout. Building the package requires the
Dart SDK, which the Nix dev shell provides.

<!-- @code src/core/glob.ts#collectFiles -->
## File Collection

File collection walks the project root, applies the ignore rules above, and
returns the managed files for each include pattern.

<!-- @code src/core/markdown.ts#scanMarkdown -->
## Markdown Scanning

Markdown scanning extracts heading anchors and `@code` annotations from a
single Markdown file.

<!-- @code src/core/typescript.ts#scanTypeScript -->
## TypeScript Scanning

TypeScript scanning extracts exported declarations and `@doc` annotations using
the TypeScript Compiler API.

For each supported declaration the scanner records, alongside the name range
used for navigation, a `declarationRange` covering the whole declaration
including its leading JSDoc block. The
[context command](cli.md#context-command) extracts declaration content from
this range.

The scanner also records a `signatureRange` for the declaration's public
surface. The signature range includes the leading JSDoc block but excludes
implementation bodies when the syntax has one, including function bodies, class
bodies, and supported `const` initializers with arrow-function, function,
class, or object bodies.

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
library-private declarations with a leading underscore, so identifiers that
start with `_` are excluded. `include.code.dart.visibility` accepts only
`public`.

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
