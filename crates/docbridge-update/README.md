# docbridge-update

Independent Rust 1.83 library for the approved #213 signed standalone updater.
The parent CLI owns argument parsing, presentation, executable discovery, and interactive confirmation.
This crate never writes project settings or Skills.

## CLI integration

Interactive upgrades use the two-phase API, so the confirmation is bound to one verified version and one set of bytes:

```rust,no_run
use docbridge_update::{apply, decline, plan, Options};
let mut options = Options::new(std::env::current_exe().unwrap(), "1.0.0");
let outcome = match plan(&options) {
    Err(outcome) => outcome, // Current (code 0) or Error (code 1)
    Ok(plan) => {
        // Ask about plan.version() / plan.sha256(); never re-download after asking.
        if ask_user(plan.version()) {
            options.confirmed = true;
            apply(plan, &options)
        } else {
            decline(&plan)
        }
    }
};
print!("{}", outcome.stdout);
eprint!("{}", outcome.stderr);
std::process::exit(outcome.code);
# fn ask_user(_: &docbridge_update::Version) -> bool { false }
```

`plan` downloads and verifies the metadata, signed manifest and executable once, and returns a `Plan` holding the version, target, signed SHA256 and the verified bytes in memory.
`apply` installs exactly those bytes; it re-checks that the executable path, target and byte hash still match the plan and never fetches again.
`run(&options)` is a convenience wrapper for `plan` followed by `apply` (for `--check`, `--dry-run` and `--yes`).

`Options` exposes `executable`, `current_version`, `target`, `check`, `dry_run`, `yes`, and `confirmed`.
`Options::new` selects the native supported release target.
Set `confirmed` only after affirmative interactive confirmation of the proposed plan; never set it just because stdin is interactive.
`check` and `dry_run` take precedence over both confirmation flags and perform zero filesystem writes, including zero cleanup/recovery writes and no lock file.

`Outcome` exposes `stdout`, `stderr`, `code`, and `status` (`Status::{Updated, Available, Current, Declined, ConfirmationRequired, Error}`).

| Status                 | Code | Meaning                                                                                 |
| ---------------------- | ---- | --------------------------------------------------------------------------------------- |
| `Updated`              | 0    | Replaced; backup kept until the next upgrade or `cleanup`.                              |
| `Available`            | 0    | `check`/`dry_run` found a verified newer release.                                       |
| `Current`              | 0    | Already at the latest stable release; no artifacts downloaded.                          |
| `Declined`             | 0    | Interactive "no", produced by `decline(&plan)`.                                         |
| `ConfirmationRequired` | 1    | `apply` without `yes` or `confirmed`; nothing written.                                  |
| `Error`                | 1    | Verification, provenance, network, lock, preparation, replacement, or recovery failure. |

The CLI maps a non-interactive run without `--yes` to `ConfirmationRequired` (exit 1) by calling `run`/`apply` without setting `confirmed`, and maps an interactive "no" to `decline` (exit 0).
Replay/downgrade metadata is an error.

`plan_with(options, release_client, trusted_keys)`, `apply_with(plan, options, file_ops)` and `run_with(options, release_client, trusted_keys, file_ops)` are the application/test seams.
`ReleaseClient` provides `latest()` and `fetch(release, filename)`.
`FileOps` provides rename and staged-file write injection for permission, partial-write/full-storage, replacement, and rollback fixtures.
These are trusted application interfaces, not CLI or environment overrides.
Production uses `OfficialClient`, `NativeFileOps`, and compiled maintainer-approved `TrustedKeys`.

**Production key provisioning is pending.**
`compiled_trusted_keys()` intentionally returns an empty map, so `run` refuses a newer release until a maintainer-approved public key is compiled in.
The parent may call `run_with` using its own compiled key map.
Never load trust keys or release URLs from CLI arguments, project settings, or environment variables.
No production key was invented; deterministic private signing keys exist only in integration-test code.

## Distribution format

The production client uses only the latest stable release at `https://api.github.com/repos/salan70/docbridge/releases/latest`.
It rejects drafts and prereleases rather than selecting them for installation.
Download URLs must exactly match `https://github.com/salan70/docbridge/releases/download/<selected-tag>/<filename>` from that release's assets.
Redirects are manually bounded and restricted to HTTPS GitHub/API/official asset CDN hosts, with credentials and nonstandard ports rejected.
TLS uses ureq/rustls certificate validation against the bundled `webpki-roots` (Mozilla) trust anchors, not the OS trust store; there is no unsafe TLS switch.
TLS-intercepting proxies or private CAs therefore fail closed with a network error.
Metadata, manifest, signature, and executable downloads have size bounds, a 30 s connect timeout and a 60 s per-read timeout (no overall deadline, so a slow but progressing download completes).
Redirect, allowlist, non-200 and size-cap policy sits behind an internal transport seam and is unit-tested with fake transports.

The release contains:

- `docbridge-manifest.json`: exact UTF-8 JSON bytes signed without normalization.
- `docbridge-manifest.sig`: raw 64-byte detached Ed25519 signature of those bytes.
- One raw executable per supported target, with the names below.

```json
{
  "schema": 1,
  "version": "1.2.3",
  "key_id": "maintainer-key-id",
  "assets": [
    {
      "target": "aarch64-apple-darwin",
      "filename": "docbridge-aarch64-apple-darwin",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

The SHA256 above is illustrative, not a released executable checksum.
Only `key_id` is read as an untrusted routing hint before signature verification.
It must select an already-trusted compiled public key.
Strict Ed25519 verification of the exact raw manifest precedes using its version, targets, filenames, or hashes.
The signed version is canonical semver without a leading `v`, must equal the selected tag's semver (tag may have one leading `v`), and must be strictly newer than the running version.
Build metadata alone never makes a version newer; version precedence ignores build metadata while tag/manifest binding still compares the complete version.
All asset targets must be supported and unique, filenames must exactly match their target, and SHA256 must be 64 lowercase hex characters.
Unknown manifest fields and duplicate required JSON fields are rejected.
The signed manifest binds the downloaded executable's SHA256 to its version and target; there is no independent unsigned checksum authority or verification bypass.
The manifest has no expiry or timestamp: an attacker able to serve old, validly signed releases can withhold newer releases (freeze), but cannot roll back below the running version.

| Target                       | Raw release asset                      |
| ---------------------------- | -------------------------------------- |
| `aarch64-apple-darwin`       | `docbridge-aarch64-apple-darwin`       |
| `x86_64-apple-darwin`        | `docbridge-x86_64-apple-darwin`        |
| `aarch64-unknown-linux-musl` | `docbridge-aarch64-unknown-linux-musl` |
| `x86_64-unknown-linux-musl`  | `docbridge-x86_64-unknown-linux-musl`  |
| `x86_64-pc-windows-msvc`     | `docbridge-x86_64-pc-windows-msvc.exe` |

## Standalone installation receipt

The standalone installation procedure is:

1. An installer verifies the official release's signed manifest and executable SHA256 against compiled maintainer-approved keys.
2. The installer installs the verified executable at the selected unmanaged location and applies its ordinary executable permissions.
3. The installer calls `write_install_receipt(&installed_executable)` to record that deliberate standalone installation.

This library provides step 3 as an explicit installer API; it does not implement a separate installation/download command.
`write_install_receipt` refuses managed paths and refuses to overwrite an existing receipt.
It is never called by `run` to adopt an unknown installation.
A direct binary download without this receipt receives guidance rather than replacement.

The adjacent `<executable-name>.docbridge-receipt.json` is a private regular nonsymlink file:

```json
{
  "schema": 1,
  "executable": "/canonical/absolute/path/docbridge",
  "sha256": "<installed-executable-lowercase-sha256>"
}
```

The canonical executable path and current executable hash must both match.
The executable itself must be a regular nonsymlink file.
Known canonical managed locations (Nix/Guix, Homebrew, system package directories, npm node_modules, MacPorts, Snap, and common Windows package locations) always override a receipt.
Detection is independent of the current working directory and returns package-manager guidance.

## Replacement and recovery

Verification happens in memory for read-only operations.
An authorized `apply` first takes the exclusive lock `<executable-name>.docbridge-update.lock` (adjacent to the executable, created with `create_new`, removed when the operation ends).
`apply`, `cleanup` and `recover` all hold this lock; `plan`, `check` and `dry_run` never take it.
A lock left behind by a killed process is never broken automatically: every locked operation fails with an error naming the lock file and telling the user to remove it if no upgrade is running.

Under the lock, `apply` removes consistent leftovers from earlier transactions (committed, known-restored, or never-mutated preparation) exactly as `cleanup` does, so consecutive upgrades need no explicit cleanup.
It then creates a private adjacent `<executable-name>.docbridge-update/` directory using exclusive directory creation.
The journal (`phase: preparing`) is written first, before any other file, so every later leftover is attributable.
Unix directory/file modes start at 0700/0600; Windows inherits the installation directory's ACL, so the installer must choose a directory writable only by the intended account or administrators.
Backups, replacement bytes, receipt, and transaction journal are synced before executable mutation, on the executable's filesystem.
Staged executable and receipt bytes are verified again before replacement.
Ordinary Unix permission bits are preserved; setuid/setgid/sticky bits are never propagated to replacement or backup copies.

Unix atomically renames the replacement over the executable while retaining `old-binary` and `old-receipt.json`.
Windows first renames the running executable to `running-binary` in the recovery directory, then moves the verified replacement into place.
The journal moves `preparing` -> `staged` -> `committed`; the receipt is replaced after the binary and the journal is marked committed last.
Failed replacement attempts restore both old executable and receipt from retained backups through fixed-name scratch files (`restore-binary.tmp`, `restore-receipt.tmp`) and mark the journal `restored`.
On Windows, restoration moves a present replacement aside to `failed-binary` only if that name does not already exist, so an earlier backup is never overwritten.
A successful rollback reports that the old install was restored and that the next upgrade or cleanup removes the backup; it does not ask for `recover`.
If rollback fails, the error explicitly names the executable, backup binary, backup receipt, and `running-binary` when it exists (Windows) for manual recovery.
A preparation failure (for example a partial write or full disk) leaves the executable untouched and removes the files this transaction created plus the directory; if that removal itself fails, the next upgrade or cleanup removes the attributable leftovers.

Only an inconsistent state, where the installed executable/receipt match neither the old nor the committed new state of the journal, blocks another update and asks for `recover`, including during check/dry-run.
Use `recover(original_executable_path, true)` only after explicit recovery confirmation; the original absolute path works even if the executable is temporarily absent.
Recovery takes the lock, validates journal path binding, backup hash, and old receipt before restoring, and refuses to overwrite an unrecognized modified executable.
Recovery preserves its backups.

The parent may also call `cleanup(executable_path)` on a later normal launch; it takes the lock and removes only recognized validated backup/staging files from a committed, restored, or never-mutated transaction, and succeeds when there is nothing to clean.
Do not call cleanup during check/dry-run.
Locked Windows backups are left for a later retry with an explicit error, and partial cleanup is retryable.
Unknown entries, substituted backup bytes, symlinks, and uncommitted replacement states are preserved for inspection.
There is no automatic deletion of arbitrary paths or recursive directory removal.
These guarantees concern normal I/O failures and process interruption; they do not claim protection against a malicious process already able to mutate the executable's directory concurrently, or absolute power-loss guarantees on every filesystem.

## Validation and platform limits

The crate is a member of the repository's Cargo workspace and uses the root Rust 1.83 toolchain. From the repository root:

```text
cargo test --package docbridge-update --locked --target-dir .tmp/rust-vnext
cargo fmt --all -- --check
cargo clippy --package docbridge-update --locked --target-dir .tmp/rust-vnext --all-targets -- -D warnings
```

Integration tests use temp directories, binary byte fixtures, and test-only Ed25519 keys; they do not modify a real executable or perform a real release.
All five release target bindings are exercised on the host.
Windows-specific rename-aside/deferred-cleanup tests are gated by `cfg(windows)` and require execution on Windows before claiming native Windows validation.
No minimum OS version or cross-platform runtime execution is claimed by host-only tests.
Production distribution signatures still require CI/delivery integration and maintainer key provisioning.

Ed25519 uses maintained `ed25519-dalek` 2.2, and SHA256 uses RustCrypto `sha2`.
Direct `url` and `tempfile` pins, plus the `Cargo.lock` entries for the transitive `base64ct` 1.6.0 and `zeroize` 1.8.1, keep this independent crate buildable with Rust 1.83 (`--locked`) without changing any other crate's toolchain.
Do not run a blanket `cargo update` without rechecking `cargo +1.83.0 build --locked`.
