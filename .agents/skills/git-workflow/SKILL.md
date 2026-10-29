---
name: git-workflow
description: DocBridge git workflow — branching, PR-based integration, merge commits, and agent approval gates. Use when branching, committing, pushing, opening or merging a PR, or choosing a PR's release label.
---

# git-workflow

- No direct pushes to `main`; never bypass branch protection or the required
  `ci` and `release-label` checks.
- Agents may branch, commit, push, and open PRs. **Merging a PR requires
  explicit human approval** and uses **Create a merge commit**
  (`git log --first-parent main` for the PR view).
- Only a maintainer publishes a release, by dispatching Release vNext.
- Branch, commit, and PR conventions:
  [Git and pull requests](../../../docs/contributing/README.md#git-and-pull-requests).

## Standard change flow

1. Branch from a freshly fetched `main`:
   `git fetch origin && git switch --no-track -c <branch> origin/main`. This
   works even while another worktree holds `main`.
2. Choose the release label and run the bump per
   [Git and pull requests](../../../docs/contributing/README.md#git-and-pull-requests).
3. Before committing, review the linked counterparts of each changed file or
   section with `just links <path> --include-content`. The `pre-commit` hook
   runs `just verify` over the working tree, not only the staged snapshot. If
   `git config core.hooksPath` is unset, run `just setup`.
4. Push with `git push -u origin <branch>` and open the PR with the template and
   exactly one `release:` label.
5. After merge, run `git fetch --prune origin` and confirm that
   `git merge-base --is-ancestor <branch> origin/main` succeeds. Then leave the
   branch: remove a linked worktree with `git worktree remove <path>`, or in
   the main checkout switch to `main`, or to `--detach origin/main` while
   another worktree holds `main`. Delete the branch with `git branch -D <branch>`.
