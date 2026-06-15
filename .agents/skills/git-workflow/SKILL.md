---
name: git-workflow
description: SpecLink git workflow rules and procedures — branch naming, PR-based integration, merge commits, main branch protection, AI agent autonomy gates, and the semi-automated release process. Use when branching, committing, pushing, opening or merging a PR, or cutting a release.
---

<!--
Example prompts:
  $git-workflow
  $git-workflow open a PR for the current branch
  $git-workflow cut the v0.2.0 release
-->

# git-workflow

SpecLink integrates every change through a pull request. `main` is protected and
cannot be pushed to directly. Follow these rules for all git work.

## Invariants

- No direct pushes to `main`. Every change lands through a PR. GitHub enforces
  this for everyone, including administrators.
- Merge method is **Create a merge commit**. PR boundaries stay visible in
  `main` history; use `git log --first-parent main` for a PR-level view.
- CI (`just check`, `just typecheck`, `just test`, `just build`) must pass
  before a PR can merge.
- Commit messages follow
  [docs/contributing/commits.md](../../../docs/contributing/commits.md):
  `<gitmoji> <type>(<scope>): <summary>`, written in English, with unrelated
  changes split into separate commits.

## Branch naming

Use a small prefix set. The precise change type lives in the commit message, not
the branch name.

- `feat/<kebab-desc>` — new capability
- `fix/<kebab-desc>` — bug fix
- `chore/<kebab-desc>` — everything else (docs, refactor, ci, build, test,
  dependencies, maintenance)
- `release/vX.Y.Z` — release preparation only

Examples: `feat/version-flag`, `fix/anchor-resolution`, `chore/git-workflow`,
`release/v0.1.0`.

## Standard change flow

1. Sync local `main` first: `git switch main && git pull --ff-only`. Never branch
   from a stale `main`.
2. Create the branch from `main` using the naming above.
3. Implement test-first. For logic changes, use the `tdd` skill.
4. Commit in focused, logical commits. The `pre-commit` hook runs `just check`
   and `just test`.
5. Push the branch and open a PR using the repository PR template. Write the PR
   title and body in English (see the Language Policy).
6. Wait for CI to pass.
7. Merge with **Create a merge commit** once CI is green.
8. After merge, return to an updated `main` and remove the local branch:
   `git switch main && git pull --ff-only && git branch -d <branch>`.

## AI agent autonomy gates

For AI agents (Claude, Codex):

- Autonomous: create branches, commit, push, and open PRs.
- Requires explicit human approval: **merging a PR**. Release tagging and
  publishing are automated by GitHub Actions when the release PR is merged, so
  the merge is the release approval gate.
- Never push to `main` directly. GitHub blocks it; do not attempt to bypass it.

## Branch protection (reference)

`main` protection is configured as:

- Require a pull request before merging, with `0` required approvals (solo
  project; self-approval is not possible on personal repositories).
- Require the `ci` status check to pass.
- Require branches to be up to date before merging.
- Allow merge commits. Do not enable "Require linear history"; repository
  settings should allow **Create a merge commit** and disable squash/rebase
  merge methods.
- Block force pushes and branch deletion.
- Apply to administrators with no bypass. To recover from a stuck state, an admin
  temporarily relaxes protection rather than force-pushing routinely.

## Releases (GitHub Actions)

Versioning follows SemVer. During `0.x`, new features bump the minor version.

Keep `CHANGELOG.md` current: in every PR that changes user-facing behavior, add
entries under `## [Unreleased]`, following Keep a Changelog. The release
workflows require a non-empty `## [Unreleased]` section and fail loudly without
one.

Releases are driven by two GitHub Actions workflows; no local tagging is needed.

To cut release `vX.Y.Z`:

1. On GitHub, run **Actions → Release Prepare** and choose the bump
   (`patch` / `minor` / `major`). It bumps `version` in `package.json`, rolls
   `CHANGELOG.md` (moves `## [Unreleased]` into `## [X.Y.Z] - <date>`, leaves a
   fresh empty `## [Unreleased]`, and refreshes the link references), pushes
   `release/vX.Y.Z`, and opens the release PR.
2. Wait for CI to pass on that PR.
3. A human merges the PR with **Create a merge commit**. This merge is the
   release approval gate.
4. **Release Publish** then runs automatically on the merge: it re-checks CI for
   the merge commit, extracts the matching `CHANGELOG.md` section, and creates
   the `vX.Y.Z` tag plus a GitHub Release in one step (`gh release create`, no
   separate tag push and no PAT). This project attaches no artifacts and
   publishes nothing to npm.

A `workflow_dispatch` fallback on **Release Publish** (input: version) exists for
recovery if the automatic run does not fire.

One-time repo setup: enable **Settings → Actions → General → Workflow
permissions → Allow GitHub Actions to create and approve pull requests** so
Release Prepare can open the PR.
