---
name: git-workflow
description: DocBridge git workflow — branching, PR-based integration, merge commits, and agent approval gates. Use when branching, committing, pushing, opening or merging a PR.
---

# git-workflow

- No direct pushes to `main`; never bypass branch protection or the required
  `ci` check.
- Agents may branch, commit, push, and open PRs. **Merging a PR requires
  explicit human approval**; the merge method is set by
  [branch protection](../../../docs/contributing/releasing.md#branch-protection).
- Branch, commit, and PR conventions:
  [Git and pull requests](../../../docs/contributing/README.md#git-and-pull-requests).

## Standard change flow

1. Branch from a freshly fetched `main`:
   `git fetch origin && git switch --no-track -c <branch> origin/main`. This
   works even while another worktree holds `main`.
2. Before committing, review linked counterparts as
   [Documentation](../../../docs/contributing/README.md#documentation) requires.
   If `git config core.hooksPath` is unset, run `just setup`; the hook is
   described in
   [Development environment](../../../docs/contributing/README.md#development-environment).
3. Push with `git push -u origin <branch>` and open the PR.
4. After merge, run `git fetch --prune origin` and confirm that
   `git merge-base --is-ancestor <branch> origin/main` succeeds. Then leave the
   branch: remove a linked worktree with `git worktree remove <path>`, or in
   the main checkout switch to `main`, or to `--detach origin/main` while
   another worktree holds `main`. Delete the branch with `git branch -D <branch>`.
