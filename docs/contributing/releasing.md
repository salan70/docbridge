# Releasing

Maintainer reference for releasing a version and the repository configuration it
needs. Per-PR release labels and version bumps are in
[Contributor guide](README.md#git-and-pull-requests).

## Branch protection

`main` is protected as follows:

- Require a pull request before merging, with `0` required approvals.
- Require the `ci` and `release-label` status checks to pass.
- Require branches to be up to date before merging.
- Allow only **Create a merge commit**; disable squash and rebase merges, and do
  not enable "Require linear history".
- Block force pushes and branch deletion.
- Apply to administrators with no bypass. To recover from a stuck state, an
  admin temporarily relaxes protection instead of force-pushing.

Never record credential values in git, logs, or issue comments.

## vNext release (manual)

The Rust CLI is released only by a maintainer dispatching **Release vNext**
(`release-vnext.yml`). Nothing publishes on merge. The asset format is the contract in
[`crates/docbridge-update/README.md`](../../crates/docbridge-update/README.md#distribution-format).
The workflow also attaches an unsigned `SHA256SUMS` for manual downloads; the
upgrade verifier never trusts it. Key custody, npm handling,
and Nixpkgs responsibility are set by the
[maintainer decisions](../specs/vnext-contracts.md#decisions).

### Cutover order

Release mode of **Release vNext** first runs `publisher-gate` (`xtask`) and
refuses to start while any other workflow runs `npm publish` or creates or edits
GitHub releases; `just lint-actions` runs the same check. Remaining steps:

1. Provision the keys (below) and dispatch the first vNext release (`0.17.0`).
2. Deprecate the npm package (step 7 of [Releasing](#releasing)). Also remove
   the npm Trusted Publisher configured for `release-publish.yml` from the npm
   `docbridge` package settings.

**Pending: key provisioning.** `crates/docbridge-update/keys/trusted-keys.txt`
is empty, so `compiled_trusted_keys()` trusts nothing and a release run fails
closed before signing.

<!-- @code crates/docbridge-release/src/main.rs -->
<!-- @code crates/docbridge-release/src/lib.rs -->
<!-- @code crates/docbridge-release/src/operations/tag.rs -->
<!-- @code crates/docbridge-release/src/operations/dry_run.rs -->

### Signing tool

`crates/docbridge-release` (binary `docbridge-release`, not published) produces
and checks the asset set with the upgrade verifier's own code:

```text
docbridge-release sign --version X.Y.Z --artifacts DIR --out DIR --key-id ID \
  (--key-file PATH | --key-env NAME)
docbridge-release verify --dir DIR --version X.Y.Z \
  (--compiled-keys | --key-id ID --public-key HEX)
docbridge-release public-key (--key-file PATH | --key-env NAME)
docbridge-release trusted-keys
docbridge-release tag check VERSION SHA
docbridge-release tag ensure VERSION SHA
docbridge-release dry-run --artifacts DIR --out DIR --version VERSION
```

- The private key is a 32-byte Ed25519 seed written as 64 hex characters. It
  is read only from a file or an environment variable, never from arguments.
- `sign` requires exactly the five executables named by `filename(target)` in
  the artifacts directory and a new output directory. It verifies the set
  before succeeding.
- `verify` requires exactly the eight release assets, checks `SHA256SUMS`, and
  runs `docbridge_update::plan_with` for every target as the `vX.Y.Z` release.
- `tag check` requires an absent tag or a lightweight tag at exactly the supplied commit; lookup failures and annotated tags fail closed.
- `tag ensure` applies the same checks and creates only an absent tag through GitHub, using `GITHUB_REPOSITORY` and the caller's origin.

### Dry run

The `release-dry-run` CI job, and **Release vNext** in its default `dry-run`
mode, run `docbridge-release dry-run` on the five built binaries with an
in-memory throwaway key. It creates no tag or release and uses no secret.

### Required configuration

- A GitHub environment named `release`, restricted to `main`, with required
  reviewers.
- One secret per primary key in that environment, named
  `DOCBRIDGE_RELEASE_SIGNING_KEY_<ID>` (the key ID upper-cased, with `.` and
  `-` as `_`): the private seed as 64 hex characters.
- The environment variables `DOCBRIDGE_RELEASE_KEY_ID` (the active key ID) and
  `DOCBRIDGE_RELEASE_KEY_SECRET` (the name of its secret). The `sign` job
  refuses a secret name that does not belong to the key ID.
- `crates/docbridge-update/keys/trusted-keys.txt` in the released commit, with
  the primary and backup public keys. The `sign` job refuses fewer than two
  compiled keys or a key ID that is not among them.

<!-- @code crates/docbridge-release/src/operations/keygen.rs -->
<!-- @code crates/docbridge-release/src/operations/keygen/privacy.rs -->

### Provisioning the keys

Pending: not run yet. The maintainer runs this once, locally, from the checkout
root with `gh` authenticated as a repository admin. Build the tool first with
`cargo build --locked -p docbridge-release --target-dir .tmp/rust-vnext`. Outside
the checkout, pass `--root /path/to/checkout` to `keygen`.

On Unix, staging and activation (including the read-only activation check)
reject group- or other-writable paths, so a common `umask 002` fails. From a
checkout you own, run:

```sh
chmod go-w . crates crates/docbridge-update crates/docbridge-update/keys \
  crates/docbridge-update/keys/trusted-keys.txt
```

If you do not own the paths, use a controlled private checkout. The checkout and
its ancestors must be nonsymlink directories, and `trusted-keys.txt` a
nonsymlink regular file. Use an absolute physical path without `..`; on macOS,
the `pwd -P` path or a path under `/private/tmp`, not `/tmp`.

```sh
.tmp/rust-vnext/debug/docbridge-release keygen --role primary --key-id docbridge-2026-primary
mkdir -m 0700 /path/to/private-local-directory
.tmp/rust-vnext/debug/docbridge-release keygen --role backup --key-id docbridge-2026-backup \
  --backup-out /path/to/private-local-directory/docbridge-2026-backup.key
# After the pull request with trusted-keys.txt is merged:
.tmp/rust-vnext/debug/docbridge-release keygen --activate --key-id docbridge-2026-primary
```

- `--role primary` stages a key: it appends `<key-id> <public-key>` to
  `trusted-keys.txt`, then pipes the seed from memory to
  `gh secret set DOCBRIDGE_RELEASE_SIGNING_KEY_<ID> --env release`. It never
  changes the active key ID or any other secret. If the upload fails, remove the
  new line from `trusted-keys.txt` and run again.
- `--role backup` exclusively creates a new 0600 file in a private 0700
  directory (not a symlink), then appends the public entry. The seed is never
  uploaded. If the public entry fails to append, the seed file may remain
  unregistered: inspect `trusted-keys.txt`, securely remove the unregistered
  seed, and do not retry the same path. Move the file to offline storage and
  securely remove other copies. FAT and exFAT filesystems can be refused;
  native Windows backup export fails closed.
- `--activate` asks you to type the key ID, checks that it is in
  `trusted-keys.txt` and that its secret exists, then sets
  `DOCBRIDGE_RELEASE_KEY_SECRET` and `DOCBRIDGE_RELEASE_KEY_ID`. If it fails
  between the two variables, the `sign` job refuses the mismatched pair until
  you run it again.
- Commit `trusted-keys.txt` in a reviewed pull request. The CLI trusts the keys
  only from the first release built with it. A key file containing a
  deterministic test-fixture public key is rejected.

### Releasing

1. Merge a pull request that sets `crates/docbridge/Cargo.toml` to the new
   version (`0.17.0` for the first vNext release). The trusted keys must
   already be merged.
2. Dispatch **Release vNext** from `main` with mode `release` and that version,
   then approve the `release` environment deployment.
3. `prepare` refuses a ref other than `main`, a version that differs from the
   crate, any other workflow that still publishes, and a `vX.Y.Z` tag at
   another commit. A failed tag lookup is an error, not "absent".
4. `build` builds and smoke-tests the five targets (Linux as static musl).
5. `sign` runs in the `release` environment and fails on a missing key ID,
   secret name, or secret, a secret name that does not belong to the key ID, or
   compiled keys that lack both keys.
6. `publish` refuses an existing release or draft for the tag. It creates a
   **draft** with every asset, re-downloads and verifies the complete set
   against the compiled keys, then creates the `vX.Y.Z` tag at the dispatched
   commit or confirms an existing tag points exactly at it. GitHub ignores a
   draft's target, so a tag at another commit, an annotated tag, or a failed
   lookup stops the run. Only then does it publish the draft, mark it latest,
   and check the tag again.
7. After the first vNext release, deprecate the npm package once, from an npm
   account that owns `docbridge`. Never run `npm unpublish`.

   ```sh
   npm deprecate docbridge "docbridge on npm is replaced by the native DocBridge CLI; install it as described at https://github.com/salan70/docbridge#install"
   ```

### Recovering from a partial failure

A failure before the final step leaves at most a draft release, which the
upgrade client ignores.

- Failure in `prepare`, `build`, or `sign`: nothing was created. Fix the cause
  and dispatch again.
- Failure in `publish` before the final step: delete the draft with
  `gh release delete vX.Y.Z --yes` and dispatch again from the same commit. A
  tag the run already created points at that commit and is accepted. To release
  a different commit, delete that tag first. Do not repair a draft by hand.
- Failure of the final publish call: check whether the release is published.
  If it is, run `gh release download vX.Y.Z --dir assets` and
  `docbridge-release verify --compiled-keys --dir assets --version X.Y.Z`. If
  it is still a draft, delete it and dispatch again.
- A published release later found wrong: do not delete or edit its assets.
  Release a higher version; the verifier rejects downgrades.

### Key rotation

The CLI accepts any key in `compiled_trusted_keys()`, selected by the
manifest's `key_id`, and always ships a primary and a backup key.

- Planned rotation:
  1. Stage the new key with `docbridge-release keygen --role primary`.
  2. Merge `trusted-keys.txt` and publish a transition release, still signed
     with the current primary key.
  3. After clients update, run `docbridge-release keygen --activate` with the
     new key ID. To roll back, activate the previous ID again.
  4. Remove the retired key from `trusted-keys.txt` in a later release, then
     delete its secret with `gh secret delete`.
- Lost or compromised primary key: remove it from `trusted-keys.txt` right
  away and delete its secret. Store the offline backup seed as the secret
  `DOCBRIDGE_RELEASE_SIGNING_KEY_<BACKUP_ID>` with
  `gh secret set ... --env release < backup.key`, run
  `docbridge-release keygen --activate` with the backup ID, and release.
  Generate a new backup key in the same pull request. Clients older than that
  release still trust the removed key until they update.

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
