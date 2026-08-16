# unlinked_doc_section

`docs/spec.md` has three headings. `## Linked` carries a `@code` annotation
paired with `src/example.ts#example`. `## Unlinked` carries none and has no
descendants, so it is reported.

`# Spec` carries no annotation either, but `## Linked` sits inside its subtree,
so the roll-up rule suppresses it. This is the nesting rule the diagnostic is
built around: only the topmost heading of a *fully* unannotated subtree is
reported.

The empty `##` after `## Unlinked` is at the same level, so it closes that
section. `### Below Empty` is therefore a separate unlinked region, not a
suppressed descendant of `## Unlinked`. Empty headings create no anchor and can
never be reported themselves, but they still shape the tree, matching the
section boundaries `docbridge context` and LSP hover use.

Under `--audit`, DocBridge reports two `unlinked_doc_section` warnings. Without
`--audit` the project is clean; this diagnostic only exists in audit mode.

Run: `just check-fixture unlinked_doc_section` (the recipe adds `--audit`)
