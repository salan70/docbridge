# Link Resolution

SpecLink v0.1 uses `file#fragment` targets.

The file path is project-root-relative. The fragment is required. Same-file targets, fragment-only targets, and file-only targets are invalid.

Targets must use `/` path separators. `./`, `../`, absolute paths, whitespace inside the target, empty file paths, empty fragments, and multiple `#` characters are invalid.

SpecLink compares target fragments as raw strings. It does not URL-decode fragments in v0.1.

Markdown heading anchors are generated from ATX headings only.

Supported heading behavior:

- heading indentation of 0 to 3 spaces
- heading levels `#` through `######`
- optional closing `#` sequence
- Unicode letters and numbers are preserved
- JavaScript `toLowerCase()` is used
- whitespace and punctuation runs become `-`
- leading and trailing `-` are removed

Setext headings are unsupported.

Fenced code blocks using backticks or tildes are recognized, and headings or `@code` comments inside them are ignored.

HTML blocks are not otherwise interpreted. A heading-like line outside a fenced code block is treated as a heading.

Empty headings do not create linkable anchors and do not participate in duplicate anchor checks. A `@code` annotation attached to an empty heading produces `dangling_code_annotation`.

Duplicate non-empty anchors inside the same Markdown file produce `duplicate_doc_anchor`. The same anchor in different Markdown files is allowed.

SpecLink uses a pair-based model:

- one TypeScript `@doc` tag creates one directed `code -> doc` link
- one Markdown `@code` comment creates one directed `doc -> code` link
- a valid link pair exists only when the same code endpoint and doc endpoint are present in both directions

One-to-many and many-to-many relationships are represented as multiple independent link pairs.

Normal code endpoint resolution is annotation-first. Markdown `@code` resolution checks whether the target code file exists and whether a matching `@doc` pair exists in that file. It does not separately check for an unannotated exported symbol with the same name.

If a TypeScript `@doc` target doc file does not exist in the managed docs set, SpecLink emits `doc_file_not_found`. If the file exists but the anchor does not, SpecLink emits `doc_anchor_not_found`. If the anchor exists but the matching `@code` is missing, SpecLink emits `doc_backlink_not_found`.

If a Markdown `@code` target code file does not exist in the managed code set, SpecLink emits `code_file_not_found`. If the file exists but the matching `@doc` pair is missing, SpecLink emits `code_backlink_not_found`.

If the target file had a read, parse, or scanner-worker failure, SpecLink
suppresses relationship diagnostics that would otherwise be derived from that
file's incomplete scan result.

Duplicate `@doc` or `@code` annotations from the same source to the same target produce `duplicate_link`.

If multiple `@doc`-annotated supported declarations in the same file expose the same code endpoint, SpecLink emits `duplicate_code_symbol`.

<!-- @code src/core/links.ts#parseLinkTarget -->
## Parsing Link Targets

A single target parser validates `file#fragment` forms so every annotation
consumer applies the same rules.

<!-- @code src/core/resolver.ts#resolveLinks -->
## Resolving Links

Resolution combines scanner outputs into relationship diagnostics under the
pair-based model described above.
