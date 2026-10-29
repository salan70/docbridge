# Releasing

Maintainer reference for how a version is released and how the repository is
configured for it. Contributor rules for release labels and version bumps live in
[CONTRIBUTING.md](../CONTRIBUTING.md#git-and-pull-requests).

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
- Never record credential values in git, logs, or issue comments.
- The npm Trusted Publisher configured for `release-publish.yml` has no
  workflow left to authorize after the cutover. The maintainer can remove it
  from the npm `docbridge` package settings.

## vNext release (manual)

The Rust CLI is released only by a maintainer dispatching **Release vNext**
(`release-vnext.yml`). Nothing publishes on merge. The asset format is the contract in
[`crates/docbridge-update/README.md`](../../crates/docbridge-update/README.md#distribution-format):
one raw executable per target, `docbridge-manifest.json`, and its detached
Ed25519 signature `docbridge-manifest.sig`. The workflow also attaches an
unsigned `SHA256SUMS` for manual downloads; the upgrade verifier never trusts
it.

The [maintainer decisions](../specs/vnext-contracts.md#decisions) set key custody,
the first version, npm handling, and Nixpkgs submission responsibility.

### Cutover order

The legacy npm publisher (`release-publish.yml`) also created `vX.Y.Z` tags and
GitHub releases and marked them latest, and `docbridge upgrade` reads the latest
release. The cutover runs in this order:

1. Done: legacy releases stayed below `0.17.0` (the last is `0.16.0`).
2. Done (#215): the legacy publisher is retired, so no workflow other than
   `release-vnext.yml` runs `npm publish` or creates or edits GitHub releases.
   Release mode of **Release vNext** runs
   `scripts/check-legacy-publisher-retired.sh .github/workflows` first and
   refuses to start while any other workflow publishes; `just lint-actions`
   runs the same check in `just verify` and CI.
3. Pending: provision the keys and dispatch the first vNext release
   (`0.17.0`) as described below.
4. Pending: deprecate the npm package.

**Pending: key provisioning.** The maintainer has not generated the keys yet.
`crates/docbridge-update/keys/trusted-keys.txt` is empty, so
`compiled_trusted_keys()` trusts nothing. A release run then fails closed
before signing and publishes nothing.

<!-- @code crates/docbridge-release/src/main.rs -->
<!-- @code crates/docbridge-release/src/lib.rs -->

### Signing tool

`crates/docbridge-release` (binary `docbridge-release`, not published) produces
and checks the asset set with the upgrade verifier's own code:

```text
docbridge-release sign --version X.Y.Z --artifacts DIR --out DIR --key-id ID \
  (--key-file PATH | --key-env NAME)
docbridge-release verify --dir DIR --version X.Y.Z \
  (--compiled-keys | --key-id ID --public-key HEX)
docbridge-release public-key (--key-file PATH | --key-env NAME)
```

- The private key is a 32-byte Ed25519 seed written as 64 hex characters. It
  is read only from a file or an environment variable, never from arguments.
- `sign` requires exactly the five executables named by `filename(target)` in
  the artifacts directory and a new output directory. It signs the manifest,
  writes the complete set, and verifies it before succeeding.
- `verify` requires exactly the eight release assets, checks `SHA256SUMS`, and
  runs `docbridge_update::plan_with` for every target as the `vX.Y.Z` release.
  That checks the key ID, signature, version/tag binding, filenames, and each
  executable's SHA-256.
- `public-key` prints the public half of a key.
- `trusted-keys` prints the key IDs compiled into this build.

`cargo test --package docbridge-release` covers genuine sets and the rejection
of tampered executables, tampered manifests, other keys, unknown key IDs,
wrong versions, missing or wrong targets, missing signatures, and incomplete
sets.

### Dry run

The `release-dry-run` CI job, and **Release vNext** in its default `dry-run`
mode, run `scripts/release-vnext-dry-run.sh` on the five built binaries. It
generates a throwaway key inside the job, signs, verifies, and checks that a
tampered executable and the compiled (still empty) trust are rejected. It
creates no tag or release and uses no secret.

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

### Provisioning the keys

The maintainer runs this once, locally, with `gh` authenticated as a repository
admin. Pending: not run yet.

```sh
scripts/release-keygen.sh --role primary --key-id docbridge-2026-primary
scripts/release-keygen.sh --role backup --key-id docbridge-2026-backup \
  --backup-out /path/to/offline-media/docbridge-2026-backup.key
# After the pull request with trusted-keys.txt is merged:
scripts/release-keygen.sh --activate --key-id docbridge-2026-primary
```

- `--role primary` stages a key. It refuses an existing secret of that name or
  a failed secret listing. It appends `<key-id> <public-key>` to
  `trusted-keys.txt` first. Then it pipes the seed from memory to
  `gh secret set DOCBRIDGE_RELEASE_SIGNING_KEY_<ID> --env release`. It never
  changes the active key ID or any other secret. If the upload fails, the seed
  is discarded; remove the new line from `trusted-keys.txt` and run again.
- `--role backup` writes the seed to a new file with mode 0600, then appends
  the public entry. Move that file to offline storage and delete every other
  copy. It is never uploaded.
- `--activate` checks that the key ID is in `trusted-keys.txt` and that its
  secret exists. Then it sets `DOCBRIDGE_RELEASE_KEY_SECRET` and
  `DOCBRIDGE_RELEASE_KEY_ID`. It asks you to type the key ID first. It never
  modifies or deletes a secret. If it fails between the two variables, the
  `sign` job refuses the mismatched pair until you run it again.
- The private key is never printed, traced (the script turns off `xtrace`
  even under `bash -x`), or passed as an argument.
- Commit `trusted-keys.txt` in a reviewed pull request. The CLI trusts the keys
  only from the first release built with it. The compiled key file is rejected
  if it contains a public key of a deterministic test fixture.

### Releasing

1. Merge a pull request that sets `crates/docbridge/Cargo.toml` to the new
   version (`0.17.0` for the first vNext release). The trusted keys must
   already be merged.
2. Dispatch **Release vNext** from `main` with mode `release` and that version,
   then approve the `release` environment deployment.
3. `prepare` refuses a ref other than `main`, a version that differs from the
   crate, any other workflow that still publishes (see
   [Cutover order](#cutover-order)), and a `vX.Y.Z` tag that exists at another
   commit. A failed tag lookup is an error, not "absent".
4. `build` builds and smoke-tests the five targets (Linux as static musl).
5. `sign` runs in the `release` environment. It fails if the key ID, the
   secret name, or the secret is missing, if the secret name does not belong
   to the key ID, or if the compiled keys do not include both keys. It signs
   once and verifies against the compiled keys.
6. `publish` refuses an existing release or draft for the tag, and a tag at
   another commit. It creates a **draft** release with every asset,
   re-downloads all assets of the draft, and verifies the complete set against
   the compiled keys. Then it creates the `vX.Y.Z` tag at the dispatched
   commit, or confirms that an existing tag points exactly at it. GitHub
   publishes a draft on an existing tag and ignores the draft's target, so a
   tag that appeared meanwhile at another commit, an annotated tag, or a failed
   lookup stops the run. Only then does it publish the draft, mark it latest,
   and check the tag again.
7. After the first vNext release, deprecate the npm package. Run this once,
   from an npm account that owns `docbridge`. Never run `npm unpublish`.

   ```sh
   npm deprecate docbridge "docbridge on npm is replaced by the native DocBridge CLI; install it as described at https://github.com/salan70/docbridge#install"
   ```

### Recovering from a partial failure

Every failure before the final step leaves at most a draft release, and the
upgrade client ignores drafts. There is never a published incomplete set.

- Failure in `prepare`, `build`, or `sign`: nothing was created. Fix the cause
  and dispatch again.
- Failure in `publish` before the final step: open the draft, then delete it
  with `gh release delete vX.Y.Z --yes`. Dispatch again from the same commit.
  A tag that the run already created points at that commit, and the next run
  accepts it. To release a different commit, delete that tag first. Do not
  repair a draft by hand; the next run refuses any existing draft for the tag.
- Failure of the final publish call itself: check whether the release is
  published. If it is, download its assets with
  `gh release download vX.Y.Z --dir assets` and run
  `docbridge-release verify --compiled-keys --dir assets --version X.Y.Z`.
  If it is still a draft, delete it and dispatch again.
- A published release later found wrong: do not delete or edit its assets.
  Release a higher version. The verifier rejects downgrades, so clients that
  already updated stay safe.

### Key rotation

The CLI accepts any key in `compiled_trusted_keys()`, selected by the
manifest's `key_id`. It always ships a primary and a backup key.

- Planned rotation:
  1. Stage the new key with `scripts/release-keygen.sh --role primary`. The
     active key, key ID, and secret are unchanged, and the previous seed stays
     in its own secret.
  2. Merge `trusted-keys.txt` and publish a transition release, still signed
     with the current primary key.
  3. After clients update, run `scripts/release-keygen.sh --activate` with the
     new key ID. To roll back, activate the previous ID again.
  4. Remove the retired key from `trusted-keys.txt` in a later release, then
     delete its secret with `gh secret delete`.
- Lost or compromised primary key: remove it from `trusted-keys.txt` right
  away and delete its secret. Store the offline backup seed as the secret
  `DOCBRIDGE_RELEASE_SIGNING_KEY_<BACKUP_ID>` with
  `gh secret set ... --env release < backup.key`, run
  `scripts/release-keygen.sh --activate` with the backup ID, and release.
  Generate a new backup key in the same pull request. Clients older than that
  release still trust the removed key until they update.

## Nixpkgs packaging (pending)

**Pending: the first vNext release and the maintainer's submission.** No
Nixpkgs pull request exists, and nothing has been accepted.

The official flake output `.#docbridge` builds the CLI from this repository's
Rust source and `Cargo.lock`. The draft
[`packaging/nixpkgs/package.nix`](../../packaging/nixpkgs/package.nix)
builds the same workspace from the `v0.17.0` GitHub source for
`pkgs/by-name/do/docbridge/package.nix`. It never reuses the published
binaries. `src.hash` and `cargoHash` are `lib.fakeHash` placeholders until a
tag exists. To check the draft against the working tree:

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
      their own account. It adds `pkgs/by-name/do/docbridge/package.nix`, with
      the body from
      [`packaging/nixpkgs/PR.md`](../../packaging/nixpkgs/PR.md).
- [ ] After acceptance, update the installation guidance to the Nixpkgs
      attribute and record the merged pull request here.

Updates: bump `version`, refresh both hashes, and rebuild on each vNext
release, through `nix-update docbridge` or by hand. A Nix installation is
managed. `docbridge upgrade` does not replace it and points to Nix instead.
`docbridge deinit` lists Nix profile and declarative removal steps.
