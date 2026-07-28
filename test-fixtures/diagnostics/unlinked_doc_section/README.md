# unlinked_doc_section

`docs/spec.md` has three headings. `## Linked` carries a `@code` annotation
paired with `src/example.ts#example`. `## Unlinked` carries none and has no
descendants, so it is reported.

`# Spec` carries no annotation either, but `## Linked` sits inside its subtree,
so the roll-up rule suppresses it. This is the nesting rule the diagnostic is
built around: only the topmost heading of a *fully* unannotated subtree is
reported.

Under `--audit`, DocBridge reports one `unlinked_doc_section` (warning).
Without `--audit` the project is clean; this diagnostic only exists in audit
mode.

Run: `just check-fixture unlinked_doc_section` (the recipe adds `--audit`)
