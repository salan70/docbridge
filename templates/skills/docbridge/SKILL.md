---
name: docbridge
description: Adopt or introduce DocBridge, choose docs and code scope, create or improve docbridge.config.json, add @doc and @code annotations, fix link diagnostics, triage related --gate findings, and review existing links for stale docs or semantic validity.
---

# docbridge

Route DocBridge work, then apply the matching judgment. Facts about the binary
— annotation syntax, supported declarations, the anchor algorithm, diagnostic
codes — live in packaged docs, not in this skill. Read them with
`docbridge docs show`. Invocation is documented in
`docbridge docs show agent-integration`.

An agent with no DocBridge skill can still finish the job from
`docbridge --help` plus `docbridge docs list` / `docbridge docs show`.

## Task router

Pick **one** job before editing. The first matching question wins:

| Job               | Ask this                                                                       | Not this                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| Adopt             | Introduce DocBridge, choose docs/code scope, or write `docbridge.config.json`? | Linking existing files                        |
| Discover and link | Choose what to link in existing docs, docs-first?                              | A known pair already confirmed                |
| Annotate          | Add or fix a `@doc` / `@code` pair, or clear link diagnostics?                 | Deciding _whether_ a section should be linked |
| Review            | Check whether the docs still match the code, with no change set?               | Gate findings on a diff                       |
| Sync              | A Git hook, CI comment, or `related --gate` flagged unchanged counterparts?    | Auditing the whole graph                      |

**Review versus sync.** Whole graph, no change set → **review**. A change set's
flagged counterparts → **sync**. "Check whether the docs still match the code"
is review. "These counterparts were not updated in this diff" is sync.

## Adopt

Survey the repo: existing config, likely specification directories, public API
locations, existing annotations, scripts, CI, and Git hooks.

Recommend docs scope, code scope, and whether to wire simple CI or hooks now.
Show the tradeoff, then wait for confirmation. Create or improve
`docbridge.config.json` only after that. Use the language-keyed `include.code`
object, never the old array form. Never replace a user-authored config blindly.

Handle CI and Git hooks conservatively: implement a simple confirmed setup;
otherwise provide a patch plan. Prefer a non-blocking gate early in adoption.

Verify with `docbridge check`. A clean zero-link result is acceptable. Then
continue into discover-and-link.

Read `docbridge docs show getting-started` and `configuration`.

## Discover and link

Work docs-first. Confirm docs scope, then follow
`docbridge docs show linking-workflow`: prioritize unlinked specification
sections, propose at most three symbols per section with why/uncertain, present
5–10 sections per round, collect adopt/exclude/hold, and classify no-matches
instead of forcing a link.

Add annotations only after section-level confirmation. Then follow Annotate.

## Annotate

Create both sides of a pair, or add the missing backlink. Read
`docbridge docs show annotations` for syntax, supported declarations, anchors,
and target grammar. Read `docbridge docs show troubleshooting` for diagnostic
codes and fixes.

Procedure: identify the declaration and the heading; add `@doc` on the
declaration (create a minimal doc comment if missing); add `@code` directly
above the heading; verify with `docbridge check`. The pair is correct only when
no diagnostic mentions either endpoint.

Do not split or rename headings in this job. Preserve existing annotations
unless the user asked to fix a wrong link.

## Sync

A `related --gate` violation means nobody has decided yet, not that the
counterpart must change. Read `docbridge docs show agent-integration` for the
three-way judgment.

1. Collect violations from the hook, CI comment, or
   `git diff --name-only HEAD | docbridge related --stdin --gate`.
2. Fetch counterpart content with `docbridge context` over the changed files.
3. Per counterpart: update it when the documented contract diverged; leave it
   unchanged with a written justification that cites the counterpart content;
   or fix the annotation pair when the link itself is wrong.
4. Re-run the gate. Report every decision.

Never detach a link to silence the gate. Do not rubber-stamp: unread
counterpart content is not a judgment. When a code change contradicts an
explicit documented promise, surface that instead of quietly rewriting the
promise.

## Review

Audit meaning across the whole graph, not a diff. Follow
`docbridge docs show link-review`.

Requires `docbridge graph --json --include-content`. Read `diagnostics` first.
Batch by docs file. Read both sides. Classify High / Medium / Low. Report
severity, endpoints, evidence, and a recommended fix. Do not edit annotations
automatically.

`check` proves mechanics; this job reviews meaning. Do not rubber-stamp a
resolving link. Prefer fewer, clearer links. Do not delete annotations to
silence uncertainty.

## Shared guardrails

- Confirm scope and section-level decisions with the user before writing links.
- Do not decide branch or pull-request policy.
- Prefer public API declarations as link targets.
- After edits, re-run `docbridge check` (and `related --gate` for sync).

## Read more

- `docbridge docs list` — the full menu
- `docbridge docs show agent-integration` — invocation, gate judgment, hooks, CI
- `docbridge docs show annotations` — `@doc` / `@code` rules
- `docbridge docs show linking-workflow` — docs-first candidate discovery
- `docbridge docs show link-review` — semantic audit
- `docbridge docs show troubleshooting` — diagnostic codes and fixes
- `docbridge docs show getting-started` — first-time setup
- `docbridge docs show configuration` — `docbridge.config.json`
- `docbridge docs show commands` — check, related, context, graph
