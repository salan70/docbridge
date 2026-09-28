---
name: pr-review
description: Review a pull request from the reviewer side. Use when asked to review a PR, inspect a PR for bugs, or post review findings. By default, a PR review includes posting actionable inline review comments on the diff unless the user explicitly asks for a local-only review.
---

# pr-review

Review a pull request as a reviewer: find real defects, verify them, and post
each confirmed finding as an inline comment on the diff. Posting is the default
scope; report locally only when the user asks for a local-only review or says
not to comment on GitHub.

## Principles

- Prioritize bugs, regressions, broken contracts, missing tests for risky
  behavior, security issues, and maintenance hazards. Skip style preferences
  unless they affect correctness or a documented contract.
- Report a finding only with a concrete failure mode. Anchor it to the changed
  line most responsible, check whether tests cover it, and reproduce it locally
  when the claim depends on behavior.
- Rate severity `P1`, `P2`, or `P3` by user impact and likelihood.
- Do not approve a PR while findings remain unresolved.
- Converse with the user in their language; write GitHub comments in English.

## Procedure

1. Read the PR metadata, the diff against its base, and the implementation,
   tests, docs, and schemas that define the changed behavior. Follow DocBridge
   links from specs to code.
2. Run verification. For changes that are not documentation-only, run
   `just verify` and `just build`.
3. Post each confirmed finding as an inline comment on the PR head commit:
   severity, observed issue, a minimal example when it makes the bug concrete,
   why it matters, and the requested fix.
4. Add a top-level comment review only for cross-cutting context or
   verification results; do not repeat the inline findings there.
5. For a local-only review, list findings by severity with file and line, then
   verification results and residual risks.
