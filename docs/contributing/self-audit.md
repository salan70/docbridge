# Repository Self-Audit

This document is the policy for DocBridge's own link graph. It does not change
the public meaning of `docbridge check --audit`. Adopters still see every
in-scope `undocumented_symbol` and `unlinked_doc_section` warning; this
repository additionally keeps a classified baseline of the warnings it has
reviewed.

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

These in-scope endpoints are expected to appear in `check --audit` and in the
baseline. They are not missing contracts:

| Class             | Meaning                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `internal_helper` | Helpers, path/range/syntax utilities, scanner-worker plumbing, and shared type aliases that are not themselves a public contract. |
| `test_support`    | Test helpers and fixtures (`*.test-support.ts`, `test-support.ts`, `src/lsp/fixtures.ts`).                                        |
| `sibling_export`  | Additional exports in a module whose primary contract is already linked.                                                          |
| `structural_doc`  | Overviews, tutorials, catalogs, workflow prose, and headings whose parent is already bridged.                                     |

Zero audit warnings is not a goal. False or low-value links are worse than a
reviewed gap.

`*.test.ts` files match `src/**/*.ts` and would appear if they exported a
supported declaration. They currently export nothing. Narrowing
`docbridge.config.json` to hide them would be an exclusion and needs separate
maintainer approval.

## Baseline

Reviewed gaps live in
[`test-fixtures/self-audit/baseline.json`](../../test-fixtures/self-audit/baseline.json).
Each entry is keyed by diagnostic `code` and canonical `target`. Message text
and line numbers are not part of the identity.

`just check-audit-baseline` and the colocated Bun test compare the live
`--audit` set to that file:

- A live key absent from the file is an unreviewed addition. Add a reciprocal
  `@doc` / `@code` pair, or add a classified baseline entry.
- A file key absent from the live set is a stale baseline entry. Delete it in
  the same change that closed the gap.

`just audit` remains a truthful report. The baseline check does not suppress,
filter, or change CLI diagnostics. It is not part of `just verify` as a
separate recipe; `bun test` already runs the comparison.

## Native scanner specifications

Swift, Dart, Rust, Go, Python, Ruby, and Java scanning headings stay
unlinked. Their implementations live in `packages/*-scanner`, which are
outside `include.code`. The in-scope TypeScript worker helper is the same
adapter factory for every language, so pointing those headings at it would be
a false relationship. Expanding `include.code` to the worker packages needs
separate maintainer approval.

Those seven headings are classified `structural_doc`. JavaScript Scanning is
linked instead, because the in-process TypeScript scanner implements it.
