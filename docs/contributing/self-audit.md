# Repository Self-Audit

This document is the policy for DocBridge's own link graph. It does not change
the public meaning of `docbridge check --audit`. Adopters still see every
in-scope `undocumented_symbol` and `unlinked_doc_section` warning, and so does
`just audit` here. No gate compares the warnings against a recorded set; apply
this policy when a change adds or removes a contract.

## What must participate

A relationship belongs in the graph when both sides describe the same contract:

- Normative behavior in `docs/specs/`.
- Task-oriented behavior in `docs/user/` (packaged user documents stay in
  `include.docs`; see #90).
- One primary exported production contract per concern under each `src/`
  layer and entrypoint. See [Module architecture](architecture.md).

The existing dogfooding style is intentional: annotate the orchestration or
entry symbol (`resolveLinks`, `loadConfig`, `run`, `Server`), not every helper
type beside it.

## Reviewed intentional gaps

These in-scope endpoints are expected to appear in `check --audit`. They are
not missing contracts:

- Helpers, path/range/syntax utilities, scanner-worker plumbing, and shared
  type aliases that are not themselves a public contract.
- Test helpers and fixtures (`*.test-support.ts`, `test-support.ts`,
  `src/lsp/fixtures.ts`).
- Additional exports in a module whose primary contract is already linked.
- Overviews, tutorials, catalogs, workflow prose, and headings whose parent is
  already bridged.

Zero audit warnings is not a goal. False or low-value links are worse than a
reviewed gap.

`*.test.ts` files match `src/**/*.ts` and would appear if they exported a
supported declaration. They currently export nothing. Narrowing
`docbridge.config.json` to hide them would be an exclusion and needs separate
maintainer approval.

## Native scanner specifications

Swift, Dart, Rust, Go, Python, Ruby, and Java scanning headings stay
unlinked. Their implementations live in `packages/*-scanner`, which are
outside `include.code`. The in-scope TypeScript worker helper is the same
adapter factory for every language, so pointing those headings at it would be
a false relationship. Expanding `include.code` to the worker packages needs
separate maintainer approval.

JavaScript Scanning is linked instead, because the in-process TypeScript
scanner implements it.
