# Releasing

Maintainer reference for how a merged pull request becomes a release and how the
repository is configured for it. The per-PR rules that contributors and agents
follow (release labels and `just release-bump`) live in the
[git-workflow skill](../../.agents/skills/git-workflow/SKILL.md#releases-per-pr).

## Publishing

When a pull request labeled `release: patch`, `release: minor`, or
`release: major` merges, **Release Publish** (`release-publish.yml`) re-checks
CI for the merge commit, builds the dist CLI with the platform scanner binaries,
and publishes the `docbridge` package to npm with
`npm publish --provenance --access public`. It authenticates through npm Trusted
Publishing (GitHub Actions OIDC), then creates the `vX.Y.Z` tag and a GitHub
Release from the matching `CHANGELOG.md` section. A version whose tag already
exists is skipped. Merging a `release: none` pull request publishes nothing.

If the automatic run does not fire, dispatch **Release Publish** manually with
the version as input. The dispatch uses the same workflow file, so it keeps the
trusted publisher identity. If publishing fails with an authentication error,
correct the npm Trusted Publisher fields (they are case-sensitive and are not
validated when saved) and dispatch again. Do not add a token-based fallback.

## Branch protection

`main` is protected as follows:

- Require a pull request before merging, with `0` required approvals (solo
  project; self-approval is not possible on personal repositories).
- Require the `ci` and `release-label` status checks to pass.
- Require branches to be up to date before merging.
- Allow only **Create a merge commit**; disable squash and rebase merges, and do
  not enable "Require linear history".
- Block force pushes and branch deletion.
- Apply to administrators with no bypass. To recover from a stuck state, an
  admin temporarily relaxes protection instead of force-pushing.

## One-time setup

- Create the four `release:` labels and make `release-label` a required status
  check on `main`.
- On the npm `docbridge` package, configure one Trusted Publisher:
  - Provider: GitHub Actions
  - Organization or user: `salan70`
  - Repository: `docbridge`
  - Workflow filename: `release-publish.yml`
  - Environment name: none
  - Allowed action: `npm publish`
- Do not add a long-lived npm write token or an `NPM_TOKEN` Actions secret, and
  never record credential values in git, logs, or issue comments.
