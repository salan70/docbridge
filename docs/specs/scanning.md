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

When a file has `file_read_error` or `code_parse_error`, derived link diagnostics that depend on that file are suppressed.

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
