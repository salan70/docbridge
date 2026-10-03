---
name: git-workflow
description: DocBridge git workflow rules and procedures — branch naming, PR-based integration, merge commits, AI agent autonomy gates, and per-PR releases. Use when branching, committing, pushing, opening or merging a PR, or choosing a PR's release label.
---

# git-workflow

DocBridge integrates every change through a pull request. `main` is protected and
cannot be pushed to directly. Follow these rules for all git work.

## Invariants

- No direct pushes to `main`. Every change lands through a PR. GitHub enforces
  this for everyone, including administrators.
- Merge method is **Create a merge commit**. PR boundaries stay visible in
  `main` history; use `git log --first-parent main` for a PR-level view.
- The `ci` and `release-label` checks must pass before a PR can merge.
- Commit messages follow
  [docs/contributing/commits.md](../../../docs/contributing/commits.md):
  `<gitmoji> <type>(<scope>): <summary>`, written in English, with unrelated
  changes split into separate commits.

## Standard change flow

1. Sync local `main` first: `git switch main && git pull --ff-only`. Never branch
   from a stale `main`.
2. Create the branch from `main` using the naming in
   [pull-requests.md](../../../docs/contributing/pull-requests.md).
3. Implement test-first. For logic changes, use the `tdd` skill.
4. Choose the PR's release kind (see [Releases](#releases-per-pr)). For
   `patch`, `minor`, or `major`, run `just release-bump <kind>` and commit the
   result. Commit in focused, logical commits. The `pre-commit` hook runs the shared,
   read-only `just verify` gate, then `just related-gate-report` over the
   staged files. The report never blocks; update each listed counterpart or
   state why it needs no update.
5. Write the PR body with the `concise-writing` skill, then push the branch and
   open a PR using the repository template. Title, body, and issue linking
   follow [pull-requests.md](../../../docs/contributing/pull-requests.md). Add
   exactly one `release:` label.
6. Wait for CI and the `release-label` check to pass.
7. Once CI is green and a human has explicitly approved the merge, merge with
   **Create a merge commit**.
8. After merge, return to an updated `main` and remove the local branch:
   `git switch main && git pull --ff-only && git branch -d <branch>`.

## AI agent autonomy gates

Agents may create branches, commit, push, and open PRs. **Merging a PR requires
explicit human approval**; merging a releasing PR also publishes the release.
Never push to `main` directly or try to bypass its protection.

`gh pr merge` asks for approval through `.claude/settings.json` and
`.codex/rules/docbridge.rules`. Neither is a security boundary: Codex's
automatic approval reviewer can approve the prompt, and `gh api` can merge
without matching either rule.

## Releases (per PR)

Versioning follows SemVer. During `0.x`, new features and breaking changes bump
the minor version; `major` is reserved for 1.0. SemVer build metadata (`+build`)
is not a release kind.

Every PR carries exactly one release label:

| Label            | Use when                                        | Version and CHANGELOG in the PR        |
| ---------------- | ----------------------------------------------- | -------------------------------------- |
| `release: none`  | No user-facing change (docs, CI, refactor, ...) | Unchanged; `## [Unreleased]` unchanged |
| `release: patch` | User-facing fix                                 | `just release-bump patch`              |
| `release: minor` | New feature, or a breaking change during `0.x`  | `just release-bump minor`              |
| `release: major` | Breaking change after 1.0                       | `just release-bump major`              |

For a releasing PR, add the user-facing entries under `## [Unreleased]`
following Keep a Changelog, then run `just release-bump <kind>`. It sets
`version` in every versioned manifest (`package.json` and
`editors/vscode/package.json`, which the VSIX packaging contract keeps equal)
through `scripts/set-release-version.ts`, and rolls `## [Unreleased]` into
`## [X.Y.Z] - <date>` through `.github/scripts/roll-changelog.mjs`.

The required `release-label` check (`.github/workflows/release-label.yml`,
`scripts/release-label.ts`) compares the PR head with the base branch tip. It
fails when the label is missing or duplicated, when the versions are not the
label's next version, or when the CHANGELOG is not rolled. It reruns when labels
change; `just check-release-label '["release: patch"]'` runs it locally.

If `main` gains another release before the PR merges, update the branch,
restore `main`'s versions and CHANGELOG sections, and run
`just release-bump <kind>` again.

Merging a releasing PR publishes it. Publishing, recovery, branch protection,
and one-time setup are maintainer concerns documented in
[Releasing](../../../docs/contributing/releasing.md).
