# Releasing

Maintainer reference for releasing a version and the repository configuration it
needs. CHANGELOG entries and the release pull request are in
[Contributor guide](README.md#git-and-pull-requests).

## Branch protection

`main` is protected as follows:

- Require a pull request before merging, with `0` required approvals.
- Require the `ci` status check to pass.
- Require branches to be up to date before merging.
- Allow only **Create a merge commit**; disable squash and rebase merges, and do
  not enable "Require linear history".
- Block force pushes and branch deletion.
- Apply to administrators with no bypass. To recover from a stuck state, an
  admin temporarily relaxes protection instead of force-pushing.

Never record credential values in git, logs, or issue comments.

## vNext release (manual)

The Rust CLI is released only by a maintainer dispatching **Release vNext**
(`release-vnext.yml`). Merging a pull request publishes nothing, and no npm or
Marketplace removal or Nixpkgs submission happens merely to close an issue.
What a release contains and how users verify it is the
[release integrity contract](../specs/vnext-contracts.md#release-integrity).

### Required configuration

A GitHub environment named `release`, restricted to `main`, with required
reviewers. The workflow uses only its own `GITHUB_TOKEN`; no secret or variable
is needed.

### Releasing

1. Merge the release pull request made with `just release X.Y.Z`.
2. Dispatch **Release vNext** from `main` with that version, then approve the
   `release` environment deployment.
3. `prepare` refuses a ref other than `main` and a version that differs from the
   workspace version. `build` builds and smoke-tests the five targets.
4. `publish` refuses an existing release or draft for the tag and a `vX.Y.Z`
   tag at another commit, an annotated tag, or a failed tag lookup. It writes
   `SHA256SUMS`, attests the executables, creates a **draft** with every asset,
   re-downloads the draft and checks it against `SHA256SUMS`, creates the tag
   at the dispatched commit or confirms it already points there, and then
   publishes the draft as latest.
5. After the first vNext release (`0.17.0`), deprecate the npm package once,
   from an npm account that owns `docbridge`, and remove the npm Trusted
   Publisher configured for `release-publish.yml` from the package settings.
   Never run `npm unpublish`.

   ```sh
   npm deprecate docbridge "docbridge on npm is replaced by the native DocBridge CLI; install it as described at https://github.com/salan70/docbridge#install"
   ```

### Recovering from a partial failure

A failure before the final step leaves at most a draft release and a tag at the
dispatched commit.

- Failure in `prepare` or `build`: nothing was created. Fix the cause and
  dispatch again.
- Failure in `publish`: delete any draft with `gh release delete vX.Y.Z --yes`
  and dispatch again from the same commit. A tag the run already created points
  at that commit and is accepted. To release a different commit, delete that
  tag first.
- A published release later found wrong: do not delete or edit its assets.
  Release a higher version.

## Nixpkgs packaging

After the first vNext release, the maintainer submits a Nixpkgs package derived
from `flake.nix`.
