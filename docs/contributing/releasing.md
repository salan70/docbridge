# Releasing

Maintainer reference for how a merged pull request becomes a release and how the
repository is configured for it. The per-PR rules that contributors and agents
follow (release labels and `just release-bump`) live in the
[git-workflow skill](../../.agents/skills/git-workflow/SKILL.md#releases-per-pr).

## Publishing

When a pull request labeled `release: patch`, `release: minor`, or
`release: major` merges, **Release Publish** (`release-publish.yml`) re-checks
CI for the merge commit, builds the dist CLI with the platform scanner binaries
and the runtime-backed workers, and publishes the `docbridge` package to npm with
`npm publish --provenance --access public`. It authenticates through npm Trusted
Publishing (GitHub Actions OIDC), then creates the `vX.Y.Z` tag and a GitHub
Release from the matching `CHANGELOG.md` section. A version whose tag already
exists is skipped. Merging a `release: none` pull request publishes nothing.

`just build` stages the Python and Ruby workers and the Java worker JAR under
`dist/workers/`, building the JAR first, so every job that runs it needs the
JDK pinned by `.java-version`. These workers are platform-independent, so no
release-matrix entry covers them; `verify-dist` and `pack-smoke` run them in
each platform job and again before publishing.

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

## vNext release (manual)

The vNext Rust CLI is released separately from the npm package, and only by a
maintainer dispatching **Release vNext** (`release-vnext.yml`). Nothing
publishes it on merge during the cutover. The asset format is the contract in
[`crates/docbridge-update/README.md`](../../crates/docbridge-update/README.md#distribution-format):
one raw executable per target, `docbridge-manifest.json`, and its detached
Ed25519 signature `docbridge-manifest.sig`. The workflow also attaches an
unsigned `SHA256SUMS` for manual downloads; the upgrade verifier never trusts
it.

Maintainer decisions:

- Key custody: the primary private key is the `DOCBRIDGE_RELEASE_SIGNING_KEY`
  secret of a protected `release` environment that requires reviewer approval.
  A backup private key is kept offline by the maintainer. The CLI compiles in
  both public keys.
- The first vNext version is `0.17.0`.
- After that release, the npm `docbridge` package is deprecated, never
  unpublished.
- The maintainer submits the Nixpkgs package from their own account.

**Pending: key provisioning.** The maintainer has not generated the keys yet.
`crates/docbridge-update/keys/trusted-keys.txt` is empty, so
`compiled_trusted_keys()` trusts nothing. A release run then fails closed
before signing and publishes nothing.

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
- The secret `DOCBRIDGE_RELEASE_SIGNING_KEY` in that environment: the primary
  private seed as 64 hex characters.
- The environment variable `DOCBRIDGE_RELEASE_KEY_ID`: the primary key ID.
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
```

- `primary` generates a seed in memory and pipes it to
  `gh secret set DOCBRIDGE_RELEASE_SIGNING_KEY --env release`. It also sets
  `DOCBRIDGE_RELEASE_KEY_ID`. It asks you to type the key ID before replacing
  the secret.
- `backup` writes the seed to a new file with mode 0600. Move that file to
  offline storage and delete every other copy. It is never uploaded.
- The private key is never printed or passed as an argument. Each run appends
  only `<key-id> <public-key>` to `trusted-keys.txt`.
- Commit `trusted-keys.txt` in a reviewed pull request. The CLI trusts the keys
  only from the first release built with it.

### Releasing

1. Merge a pull request that sets `crates/docbridge/Cargo.toml` to the new
   version (`0.17.0` for the first vNext release). The trusted keys must
   already be merged.
2. Dispatch **Release vNext** from `main` with mode `release` and that version,
   then approve the `release` environment deployment.
3. `prepare` refuses a version that differs from the crate, a tag that exists,
   or a ref other than `main`.
4. `build` builds and smoke-tests the five targets (Linux as static musl).
5. `sign` runs in the `release` environment. It fails if the secret or the
   key ID is missing, or if the compiled keys do not include both keys. It
   signs once and verifies against the compiled keys.
6. `publish` refuses an existing release or draft for the tag, then creates a
   **draft** release with every asset. It re-downloads all assets of the draft
   and verifies the complete set against the compiled keys. Only then does it
   publish the draft and mark it latest.
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
  with `gh release delete vX.Y.Z --yes`. A draft does not create the tag, so no
  tag remains. Dispatch again. Do not repair a draft by hand; the next run
  refuses any existing draft for the tag.
- Failure of the final publish call itself: check whether the release is
  published. If it is, run
  `docbridge-release verify --compiled-keys` on its downloaded assets. If it is
  still a draft, delete it and dispatch again.
- A published release later found wrong: do not delete or edit its assets.
  Release a higher version. The verifier rejects downgrades, so clients that
  already updated stay safe.

### Key rotation

The CLI accepts any key in `compiled_trusted_keys()`, selected by the
manifest's `key_id`. It always ships a primary and a backup key.

- Planned rotation: add a new key with `scripts/release-keygen.sh` and release
  once while still signing with the current primary key. After clients update,
  make the new key the primary in the `release` environment. Remove the
  retired key in a later release.
- Lost or compromised primary key: remove it from `trusted-keys.txt` right
  away. Load the offline backup seed into `DOCBRIDGE_RELEASE_SIGNING_KEY`, set
  `DOCBRIDGE_RELEASE_KEY_ID` to the backup ID, and release. Generate a new
  backup key in the same pull request. Clients older than that release still
  trust the removed key until they update.

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
      fileset = lib.fileset.unions [ ./Cargo.toml ./Cargo.lock ./crates ];
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
