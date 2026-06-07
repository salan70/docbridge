# Scanning

SpecLink v0.1 scans files matched by `include.code` and `include.docs`.

File matching is case-sensitive on every platform.

SpecLink ignores these paths even when they match an include glob:

- `node_modules`
- `.git`
- any path segment that starts with `.`
- symlink files and symlink directories

SpecLink does not read `.gitignore` in v0.1.

Code files are TypeScript `.ts` files. Declaration files ending in `.d.ts` are excluded.

Markdown files are `.md` files.

If a scan target cannot be read, SpecLink emits `file_read_error`. Config file read or parse failures use `config_file_invalid` instead.

If a TypeScript file has syntactic parse errors, SpecLink emits `typescript_parse_error` and does not extract links or symbols from that file. Other files continue to be scanned.

When a file has `file_read_error` or `typescript_parse_error`, derived link diagnostics that depend on that file are suppressed.

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
