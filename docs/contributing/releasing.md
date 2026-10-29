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
(`release-vnext.yml`). Nothing publishes on merge. What a release contains and
how users verify it is the
[release integrity contract](../specs/vnext-contracts.md#release-integrity).
npm handling and Nixpkgs responsibility are set by the
[maintainer decisions](../specs/vnext-contracts.md#decisions).

### Cutover order

**Release vNext** first runs `publisher-gate` (`xtask`) and refuses to start
while any other workflow runs `npm publish` or creates or edits GitHub releases;
`just lint-actions` runs the same check. Remaining steps:

1. Dispatch the first vNext release (`0.17.0`).
2. Deprecate the npm package (step 5 of [Releasing](#releasing)). Also remove
   the npm Trusted Publisher configured for `release-publish.yml` from the npm
   `docbridge` package settings.

### Required configuration

A GitHub environment named `release`, restricted to `main`, with required
reviewers. The workflow uses only its own `GITHUB_TOKEN`; no secret or variable
is needed.

### Releasing

1. Merge the release pull request made with `just release X.Y.Z`.
2. Dispatch **Release vNext** from `main` with that version, then approve the
   `release` environment deployment.
3. `prepare` refuses a ref other than `main`, a version that differs from the
   workspace version, and any other workflow that still publishes. `build` builds and
   smoke-tests the five targets (Linux as static musl).
4. `publish` refuses an existing release or draft for the tag and a `vX.Y.Z`
   tag at another commit, an annotated tag, or a failed tag lookup. It writes
   `SHA256SUMS`, attests the executables, creates a **draft** with every asset,
   re-downloads the draft and checks it against `SHA256SUMS`, creates the tag
   at the dispatched commit or confirms it already points there, and then
   publishes the draft as latest. Users verify downloads as described in
   [Install](../../README.md#install).
5. After the first vNext release, deprecate the npm package once, from an npm
   account that owns `docbridge`. Never run `npm unpublish`.

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

## Nixpkgs packaging (pending)

**Pending: the first vNext release and the maintainer's submission.** The draft
[`packaging/nixpkgs/package.nix`](../../packaging/nixpkgs/package.nix) builds
from the `v0.17.0` GitHub source; `src.hash` and `cargoHash` are
`lib.fakeHash` placeholders until a tag exists. To check it against the working
tree:

```sh
nix build --no-link --impure --expr '
  let
    flake = builtins.getFlake (toString ./.);
    pkgs = import flake.inputs.nixpkgs { };
    lib = pkgs.lib;
  in
  (pkgs.callPackage ./packaging/nixpkgs/package.nix { }).overrideAttrs (_: {
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./crates ./docs/specs/vnext-contracts.md ];
    };
    cargoDeps = pkgs.rustPlatform.importCargoLock { lockFile = ./Cargo.lock; };
  })'
```

Submission checklist:

- [ ] First vNext release `v0.17.0` published by **Release vNext**.
- [ ] `src.hash` and `cargoHash` filled in from a build of that tag.
- [ ] A Nixpkgs maintainer agrees to maintain the package and is listed in
      `meta.maintainers`.
- [ ] `nixpkgs-review` passes on supported Darwin and Linux systems.
- [ ] The maintainer opens the pull request against `NixOS/nixpkgs` from
      their own account, following
      [`packaging/nixpkgs/PR.md`](../../packaging/nixpkgs/PR.md).
- [ ] After acceptance, update the installation guidance to the Nixpkgs
      attribute and record the merged pull request here.

On each vNext release, bump `version`, refresh both hashes, and rebuild, through
`nix-update docbridge` or by hand.
