# Repository Self-Audit

This document is the policy for DocBridge's own link graph. It does not change
the public meaning of `docbridge check --audit`. Adopters still see every
in-scope `undocumented_symbol` and `unlinked_doc_section` warning; this
repository additionally keeps a classified baseline of the warnings it has
reviewed.

On the `main` tree that opened
[#113](https://github.com/salan70/docbridge/issues/113), `bun run src/cli/index.ts check --audit --json`
reported **163 `undocumented_symbol`**, **33 `unlinked_doc_section`**, and **0
errors**. That capture is the pre-remediation inventory. The committed baseline
is the remaining reviewed set after the high-value reciprocal links listed
below.

## What must participate

A relationship belongs in the graph when both sides describe the same contract:

- Normative behavior in `docs/specs/`.
- Task-oriented behavior in `docs/user/` (packaged user documents stay in
  `include.docs`; see #90).
- One primary exported production contract per concern under `src/core/`,
  `src/cli/`, and `src/lsp/`.

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

## High-value links added with this policy

These pairs were missing contracts, not intentional gaps:

- `src/core/resolver.ts#check` ↔ `docs/specs/cli.md#check-command`
- `src/lsp/transport.ts#encodeMessage` ↔ `docs/specs/lsp.md#transport`
- `src/cli/errors.ts#formatCliError` ↔ `docs/specs/cli.md#error-guidance`
- `docs/user/commands.md` command headings ↔ `check` / `related` / `context` /
  `graph` (`run` remains on Command dispatch)
- `docs/specs/diagnostics.md#unlinked-doc-sections` ↔ `resolveLinks`

## Follow-up clusters

The baseline class `actionable_follow_up` marks remaining high-value gaps that
need their own reviewable change. They are not ignored; they are deferred:

- Language scanner spec sections (`docs/specs/scanning.md` Swift, Dart, and
  Rust). The native scanner packages are outside `include.code`.
- `docs/specs/scanning.md#typescript-members`
- Remaining user-document task sections:
  `docs/user/annotations.md#code-to-documentation`,
  `docs/user/agent-integration.md#editing-workflow`,
  `docs/user/configuration.md#excluded-files`
- Type and config contracts: `DocBridgeDiagnostic`, `DocBridgeConfig`,
  `scanProject`, `CodeLanguageAdapter`, `buildLinkGraph`, `runLspServer`
