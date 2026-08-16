---
name: git-workflow
description: DocBridge git workflow rules and procedures — branch naming, PR-based integration, merge commits, main branch protection, AI agent autonomy gates, and the semi-automated release process. Use when branching, committing, pushing, opening or merging a PR, or cutting a release.
---

<!--
Example prompts:
  $git-workflow
  $git-workflow open a PR for the current branch
  $git-workflow cut the v0.2.0 release
-->

# git-workflow

DocBridge integrates every change through a pull request. `main` is protected and
cannot be pushed to directly. Follow these rules for all git work.

## Invariants

- No direct pushes to `main`. Every change lands through a PR. GitHub enforces
  this for everyone, including administrators.
- Merge method is **Create a merge commit**. PR boundaries stay visible in
  `main` history; use `git log --first-parent main` for a PR-level view.
- CI (`just format-check`, `just lint`, `just check`, `just typecheck`,
  `just test`, and `just build`) must pass before a PR can merge.
- Commit messages follow
  [docs/contributing/commits.md](../../../docs/contributing/commits.md):
  `<gitmoji> <type>(<scope>): <summary>`, written in English, with unrelated
  changes split into separate commits.

## Branch naming and PR titles

Follow
[docs/contributing/pull-requests.md](../../../docs/contributing/pull-requests.md)
for branch names (`<feat|fix|chore>/#<issue>-<kebab-desc>`) and pull request
titles (`<gitmoji> <type>: <summary>`). Do not restate those rules here.

## Standard change flow

1. Sync local `main` first: `git switch main && git pull --ff-only`. Never branch
   from a stale `main`.
2. Create the branch from `main` using the naming in
   [pull-requests.md](../../../docs/contributing/pull-requests.md).
3. Implement test-first. For logic changes, use the `tdd` skill.
4. Commit in focused, logical commits. The `pre-commit` hook runs the shared,
   read-only `just verify` gate.
5. Push the branch and open a PR using the repository PR template. Write the PR
   title per
   [pull-requests.md](../../../docs/contributing/pull-requests.md) and the body
   in English (see the Language Policy). For tracked work, put a plain-text
   `Closes #NN` in the Issue gate section — never wrap it in backticks, or
   GitHub will not auto-close the issue.
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
   (`patch` / `minor` / `major`). It bumps `version` in every versioned
   manifest (`package.json` and `editors/vscode/package.json`) through
   `scripts/set-release-version.ts`, rolls `CHANGELOG.md` (moves
   `## [Unreleased]` into `## [X.Y.Z] - <date>`, leaves a fresh empty
   `## [Unreleased]`, and refreshes the link references), pushes
   `release/vX.Y.Z`, and opens the release PR. The VSIX packaging contract
   rejects any drift between the two manifests, so they always move together.
2. Wait for CI to pass on that PR.
3. A human merges the PR with **Create a merge commit**. This merge is the
   release approval gate.
4. **Release Publish** then runs automatically on the merge: it re-checks CI for
   the merge commit, builds the dist CLI with the platform scanner binaries,
   publishes the `docbridge` package to npm
   (`npm publish --provenance --access public`, authenticated by npm Trusted
   Publishing via GitHub Actions OIDC — no long-lived npm token), then extracts
   the matching `CHANGELOG.md` section and creates the
   `vX.Y.Z` tag plus a GitHub Release (`gh release create`, no separate tag push
   and no PAT).

A `workflow_dispatch` fallback on **Release Publish** (input: version) exists for
recovery if the automatic run does not fire. It uses the same workflow file
(`release-publish.yml`), so it keeps the trusted publisher identity. If publish
fails with an authentication error, correct the npm Trusted Publisher fields
(they are case-sensitive and are not validated when saved) and re-run that
dispatch. Do not add a token-based fallback to the workflow.

One-time repo setup:

- Enable **Settings → Actions → General → Workflow permissions → Allow GitHub
  Actions to create and approve pull requests** so Release Prepare can open
  the PR.
- On the npm `docbridge` package, configure one Trusted Publisher:
  - Provider: GitHub Actions
  - Organization or user: `salan70`
  - Repository: `docbridge`
  - Workflow filename: `release-publish.yml` (filename only, including the
    extension)
  - Environment name: none (current identity; a GitHub environment would
    restrict which ref can publish and is a follow-up, not this migration)
  - Allowed action: `npm publish`
- Save that identity before merging a token-free publish workflow. After the
  first OIDC-backed release succeeds and provenance is verified against
  `salan70/docbridge` and `.github/workflows/release-publish.yml`, delete the
  obsolete GitHub Actions `NPM_TOKEN` secret and revoke the old npm token. Do
  not record credential values in git, logs, or issue comments.
