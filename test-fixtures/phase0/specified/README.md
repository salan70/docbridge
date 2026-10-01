# Phase 0 specified cases

Each directory is one hand-written case for the Phase 0 harness of issue #172:
`input.json` is the document `phase0-runner` reads, `expected.json` the output
it must produce. The expectations were written from
[Link Resolution](../../../docs/specs/link-resolution.md),
[Diagnostics](../../../docs/specs/diagnostics.md), and
[LSP navigation](../../../docs/specs/lsp.md#navigation-and-resolvable-one-way-links)
before the Rust port started and without running the TypeScript
implementation. `scripts/phase0-oracle.test.ts` holds the TypeScript resolver
and graph to them; `just phase0-parity` holds the Rust runner to them. These
files are never regenerated: a failure is a finding, not a stale snapshot.

## Assertions derived from the specs

- Which diagnostics fire (`doc_file_not_found`, `doc_anchor_not_found`,
  `doc_backlink_not_found`, `code_file_not_found`, `code_backlink_not_found`,
  `undocumented_symbol`, `unlinked_doc_section`) and at which location.
- Suppression of every derived diagnostic for files named by
  `file_read_error`, `code_parse_error`, a file-scoped
  `code_scanner_unavailable`, or a file-scoped `code_scanner_failed`, whether
  the file is the link's source or its target.
- The heading tree used by `unlinked_doc_section`: roll-up to the topmost
  unannotated subtree, the descendant count in the message, empty headings
  closing the section before them, and reporting descending through an empty
  heading.
- An annotated-but-unparsable `@code` counting as an annotation.
- `isMember` symbols being skipped by the audit.
- Navigation following every resolvable one-way link and never following an
  unresolved target.
- Diagnostic ordering: unlocated first, then `location.filePath`, `line`,
  `column`, `code`, `target`.
- Counterpart ordering by file path, then line, then column.
- Query results: an unknown endpoint yields an empty list; a known endpoint
  with no resolvable link yields an empty list.

## Assertions that encode implementation choices the specs do not pin

These are frozen so that the two arms agree, not because a spec requires
them. A spec change may legitimately rewrite them.

- The counterpart tie-break when file, line, and column are all equal:
  `counterpart-ordering` orders `src/a.ts#alpha` before `src/a.ts#beta`, which
  is `compareEndpointOrder`'s final comparison on the endpoint string.
- The exact wording of every message, including the backlink messages
  ("Doc anchor X has no matching @code backlink to Y.", "Code endpoint X has
  no matching @doc pair back to Y.") and the audit messages; the specs give
  only the `unlinked_doc_section` examples.
- The string order behind the file path, code, target, and endpoint
  comparisons is `localeCompare`, not code-unit order; see
  `packages/rust-core-experiment/FINDINGS.md`. The cases here use only ASCII
  and avoid pairs where the two orders disagree.
- Passthrough of `scanDiagnostics` unchanged, including their `range` and
  `language` fields, into the sorted output.
