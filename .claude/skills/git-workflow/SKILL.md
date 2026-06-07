---
name: git-workflow
description: SpecLink git workflow rules and procedures — branch naming, PR-based integration, rebase merge, main branch protection, AI agent autonomy gates, and the semi-automated release process. Use when branching, committing, pushing, opening or merging a PR, or cutting a release.
---

# git-workflow

SpecLink integrates every change through a pull request. `main` is protected and
cannot be pushed to directly. Follow these rules for all git work.

## Invariants

- No direct pushes to `main`. Every change lands through a PR. GitHub enforces
  this for everyone, including administrators.
- Merge method is **Rebase and merge**. `main` keeps a linear history; no merge
  commits.
- CI (`just check`, `just test`, `just build`) must pass before a PR can merge.
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

1. Branch from an up-to-date `main` using the naming above.
2. Implement test-first. For logic changes, use the `tdd` skill.
3. Commit in focused, logical commits. The `pre-commit` hook runs `just check`
   and `just test`.
4. Push the branch and open a PR using the repository PR template.
5. Wait for CI to pass.
6. Merge with **Rebase and merge** once CI is green.
7. Delete the merged branch.

## AI agent autonomy gates

For AI agents (Claude, Codex):

- Autonomous: create branches, commit, push, and open PRs.
- Requires explicit human approval: **merging a PR** and **pushing tags**.
- Never push to `main` directly. GitHub blocks it; do not attempt to bypass it.

## Branch protection (reference)

`main` protection is configured as:

- Require a pull request before merging, with `0` required approvals (solo
  project; self-approval is not possible on personal repositories).
- Require the `ci` status check to pass.
- Require branches to be up to date before merging.
- Require linear history.
- Block force pushes and branch deletion.
- Apply to administrators with no bypass. To recover from a stuck state, an admin
  temporarily relaxes protection rather than force-pushing routinely.

## Releases (semi-automated)

Versioning follows SemVer. During `0.x`, new features bump the minor version.

Keep `CHANGELOG.md` current: in every PR that changes user-facing behavior, add
entries under `## [Unreleased]`, following Keep a Changelog.

To cut release `vX.Y.Z`:

1. Branch `release/vX.Y.Z` from an up-to-date `main`.
2. Bump `version` in `package.json` to `X.Y.Z`.
3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - <date>`, add a
   fresh empty `## [Unreleased]`, and update the link references at the bottom.
4. Commit (`🔖 chore(release): vX.Y.Z`), push, and open a PR.
5. After CI passes and a human approves, Rebase and merge.
6. With human approval, on `main` create an annotated tag and push it:
   `git tag -a vX.Y.Z -m "vX.Y.Z"` then `git push origin vX.Y.Z`.
7. The `Release` workflow extracts the matching `CHANGELOG.md` section and
   publishes a GitHub Release. This project attaches no artifacts and publishes
   nothing to npm.
