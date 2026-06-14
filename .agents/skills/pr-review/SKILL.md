---
name: pr-review
description: Review a pull request from the reviewer side. Use when asked to review a PR, inspect a PR for bugs, or post review findings. By default, a PR review includes posting actionable inline review comments on the diff unless the user explicitly asks for a local-only review.
---

<!--
Example prompts:
  $pr-review review PR #19
  $pr-review inspect this pull request and leave findings
  $pr-review post the review comments inline on the PR
-->

# pr-review

Review a pull request as a reviewer: identify real defects, verify them, and
leave inline comments on the diff in the form that a maintainer can act on
directly. Treat "review this PR" as including GitHub inline comments unless the
user explicitly asks for a local-only review or asks not to post comments.

## Principles

- Lead with findings. Prioritize bugs, regressions, broken contracts, missing
  tests for risky behavior, security issues, and maintenance hazards.
- Do not comment on style preferences unless they affect correctness,
  maintainability, or the documented contract.
- Verify findings against the actual diff. Reproduce small examples locally when
  a claim depends on behavior.
- Prefer inline PR comments on the changed lines. For ordinary PR review
  requests, posting those inline comments is in scope by default. Use a
  top-level review summary only for cross-cutting context, verification notes,
  or when inline comments are not possible.
- Include a short code example when it makes the bug concrete.
- Keep comments concise and specific: severity, observed issue, why it matters,
  and the requested fix.
- Do not approve a PR when unresolved findings remain. Use a comment review or
  inline comments instead.

## Procedure

1. Gather PR context:
   - `gh pr view <n> --json number,title,headRefName,baseRefName,headRefOid,files,commits,reviews,url,body`
   - `git status --short --branch`
   - `git diff --stat <base>...HEAD`
   - `git diff --name-only <base>...HEAD`
2. Read the changed implementation, tests, docs, schemas, and generated outputs
   that define the changed behavior. Follow links from specs to code.
3. Form findings only when there is a concrete failure mode. For each candidate:
   - identify the changed line that causes or exposes it,
   - build the smallest realistic example,
   - check whether existing tests cover it,
   - decide severity (`P1`, `P2`, `P3`) based on user impact and likelihood.
4. Run relevant verification:
   - Prefer repo-native `just` commands.
   - If `just` is not on `PATH`, use `nix develop -c just ...`.
   - For SpecLink PRs, normally run `just check`, `just test`, and `just build`
     when the change is not documentation-only.
5. Post inline comments on GitHub by default for confirmed findings:
   - Get the PR head SHA from `gh pr view <n> --json headRefOid`.
   - Use `gh api repos/{owner}/{repo}/pulls/{n}/comments` with `commit_id`,
     `path`, `line`, `side=RIGHT`, and `body`.
   - Put the comment on the line most responsible for the issue.
   - If the finding spans multiple lines, still anchor the comment to the most
     actionable changed line unless a range comment is clearly better.
6. If the user explicitly asks for a local-only review or asks not to post
   comments, report locally instead:
   - Findings first, ordered by severity, each with file and line.
   - Verification commands and results.
   - Residual risks or test gaps.
7. If a top-level summary is useful after inline comments, post a short comment
   review with verification results only. Avoid duplicating full findings in
   both places unless the user explicitly asks for it.

## Inline Comment Template

~~~~text
P2: This [specific code behavior] causes [concrete failure mode].

For example:

```ts
[minimal example]
```

Please [specific requested fix], so [expected contract or invariant].
~~~~

## GitHub API Reference

Create an inline comment:

```sh
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -f commit_id={head_sha} \
  -f path=src/core/context.ts \
  -F line=237 \
  -f side=RIGHT \
  -f body='P2: ...'
```

Create a comment review only when inline comments are not enough:

```sh
gh pr review {pr} --comment --body '...'
```

## SpecLink Notes

- Conversation with the user should follow the user's language.
- Review comments posted to GitHub should be written in English.
- If local `just` is unavailable, use `nix develop -c just check`,
  `nix develop -c just test`, and `nix develop -c just build`.
- When the user asks to review a PR, posting inline comments on the diff is the
  default scope. Only skip posting when the user explicitly requests a
  local-only review or says not to comment on GitHub.
