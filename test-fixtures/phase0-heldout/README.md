# Phase 0 held-out cases

`heldout-01` to `heldout-10` are hand-written Phase 0 cases in the same
`input.json` / `expected.json` format as `test-fixtures/phase0/specified/`.
They are reserved for the Slice B review checkpoints of the language wave
and Rust evaluation plan (`docs/plans/language-wave-and-rust-evaluation-plan.md`):
`just phase0-parity` never runs them, a comparison task never names this
directory, and the reviewer copies the cases in only after a run reports
"ready for review". Each Slice B task names the held-out cases whose
`expected.json` it replaces.

The TypeScript baseline must satisfy every case; `scripts/phase0-oracle.test.ts`
checks that whenever the directory is present.

| Case         | Edge cases                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `heldout-01` | Parse-error and read-error suppression mixed with audit, one-way links, and member skipping                      |
| `heldout-02` | Manifest-style symmetric links located in `docbridge.links.json`, a manifest duplicate, and a one-way link       |
| `heldout-03` | Many-to-many links with partial reciprocity in both directions                                                   |
| `heldout-04` | Six-level heading nesting closed by empty headings at three levels, with roll-up counts                          |
| `heldout-05` | A subtree bridged only by its deepest leaf, and a document whose first root is deeper than its second            |
| `heldout-06` | Duplicate anchors in one file (first occurrence wins), the same anchor across files, empty and heading-less docs |
| `heldout-07` | Audit under scanner-failed, language-scoped, and read-error suppression                                          |
| `heldout-08` | Path ordering across case, punctuation, digits, and directory boundaries in diagnostics and counterparts         |
| `heldout-09` | Counterparts tied on file and position, endpoint tie-breaks, and an unannotated member as a link target          |
| `heldout-10` | Every query kind, repeated queries and links, duplicate anchors, and navigation through a parse-errored file     |
