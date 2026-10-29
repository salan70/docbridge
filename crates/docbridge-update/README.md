# docbridge-update

Independent Rust 1.83 library for the signed standalone updater.
The parent CLI owns argument parsing, presentation, executable discovery, and interactive confirmation.
This crate never writes project settings or Skills.

<!-- @code crates/docbridge/src/cli_upgrade.rs -->
<!-- @code crates/docbridge-update/src/lib.rs -->

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

`plan` downloads and verifies the metadata, signed manifest and executable once; the `Plan` holds the verified bytes in memory.
`apply` installs exactly those bytes and never fetches again.
Under the lock, before any cleanup or replacement, `apply` fails with "installation changed since the plan; re-run upgrade" and writes nothing if the installation changed after planning.
`run(&options)` is `plan` followed by `apply` (for `--check`, `--dry-run` and `--yes`).

Set `confirmed` only after affirmative interactive confirmation of the proposed plan; never set it just because stdin is interactive.
`check` and `dry_run` take precedence over both confirmation flags and perform zero filesystem writes, including zero cleanup/recovery writes and no lock file.

| Status                 | Code | Meaning                                                                                 |
| ---------------------- | ---- | --------------------------------------------------------------------------------------- |
| `Updated`              | 0    | Replaced; backup kept until the next upgrade or `cleanup`.                              |
| `Available`            | 0    | `check`/`dry_run` found a verified newer release.                                       |
| `Current`              | 0    | Already at the latest stable release; no artifacts downloaded.                          |
| `Declined`             | 0    | Interactive "no", produced by `decline(&plan)`.                                         |
| `ConfirmationRequired` | 1    | `apply` without `yes` or `confirmed`; nothing written.                                  |
| `Error`                | 1    | Verification, provenance, network, lock, preparation, replacement, or recovery failure. |

The CLI maps a non-interactive run without `--yes` to `ConfirmationRequired` by calling `run`/`apply` without setting `confirmed`, and an interactive "no" to `decline`.
Replay/downgrade metadata is an error.

`plan_with`, `apply_with` and `run_with` are trusted application/test seams (release client, trusted keys, file operations), not CLI or environment overrides.

**Production key provisioning is pending.**
`compiled_trusted_keys()` returns the keys in the checked-in `keys/trusted-keys.txt` (`<key-id> <64 lowercase hex public key>` per line).
The file is empty until the maintainer adds the primary and backup keys with `docbridge-release keygen`, so `run` refuses every newer release until then.
A malformed file yields no keys (fail closed).
Never load trust keys or release URLs from CLI arguments, project settings, or environment variables.

<!-- @code crates/docbridge-update/src/lib.rs -->
<!-- @code crates/docbridge-update/src/network.rs -->

## Distribution format

The production client uses only the latest stable release at `https://api.github.com/repos/salan70/docbridge/releases/latest`.
It rejects drafts and prereleases rather than selecting them for installation.
Download URLs must exactly match `https://github.com/salan70/docbridge/releases/download/<selected-tag>/<filename>` from that release's assets.
Redirects are bounded and restricted to HTTPS GitHub/API/official asset CDN hosts, with credentials and nonstandard ports rejected.
TLS validates against the bundled `webpki-roots` trust anchors, not the OS trust store, and has no unsafe switch; TLS-intercepting proxies or private CAs therefore fail closed.
Downloads have size bounds, a 30 s connect timeout and a 60 s per-read timeout (no overall deadline).

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

Only `key_id` is read as an untrusted routing hint before signature verification.
It must select an already-trusted compiled public key.
Strict Ed25519 verification of the exact raw manifest precedes using its version, targets, filenames, or hashes.
The signed version is canonical semver without a leading `v`, must equal the selected tag's semver (tag may have one leading `v`), and must be strictly newer than the running version.
Version precedence ignores build metadata, while tag/manifest binding compares the complete version.
All asset targets must be supported and unique, filenames must exactly match their target, and SHA256 must be 64 lowercase hex characters.
Unknown manifest fields and duplicate required JSON fields are rejected.
The manifest has no expiry or timestamp: an attacker able to serve old, validly signed releases can withhold newer releases (freeze), but cannot roll back below the running version.

| Target                       | Raw release asset                      |
| ---------------------------- | -------------------------------------- |
| `aarch64-apple-darwin`       | `docbridge-aarch64-apple-darwin`       |
| `x86_64-apple-darwin`        | `docbridge-x86_64-apple-darwin`        |
| `aarch64-unknown-linux-musl` | `docbridge-aarch64-unknown-linux-musl` |
| `x86_64-unknown-linux-musl`  | `docbridge-x86_64-unknown-linux-musl`  |
| `x86_64-pc-windows-msvc`     | `docbridge-x86_64-pc-windows-msvc.exe` |

<!-- @code crates/docbridge-update/src/install.rs -->

## Standalone installation receipt

An installer that has verified the official release's signed manifest and executable SHA256 and installed the executable at an unmanaged location calls `write_install_receipt(&installed_executable)` to record the deliberate standalone installation.
The library has no installation/download command.
`write_install_receipt` refuses managed paths and refuses to overwrite an existing receipt; `run` never calls it to adopt an unknown installation.
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
Managed locations receive package-manager guidance.

<!-- @code crates/docbridge-update/src/install.rs -->

## Replacement and recovery

An authorized `apply` first takes the exclusive lock `<executable-name>.docbridge-update.lock` (adjacent to the executable, created with `create_new`, removed when the operation ends).
`apply`, `cleanup` and `recover` all hold this lock; `plan`, `check` and `dry_run` never take it.
A lock left behind by a killed process is never broken automatically: every locked operation fails with an error naming the lock file and telling the user to remove it if no upgrade is running.

Under the lock, `apply` removes consistent leftovers from earlier transactions (committed, known-restored, or never-mutated preparation) exactly as `cleanup` does, so consecutive upgrades need no explicit cleanup.
It then creates a private adjacent `<executable-name>.docbridge-update/` directory using exclusive directory creation.
The journal (`phase: preparing`) is written first, before any other file, so every later leftover is attributable.
Windows inherits the installation directory's ACL, so the installer must choose a directory writable only by the intended account or administrators.
Backups, replacement bytes, receipt, and journal are synced before executable mutation, and staged bytes are verified again before replacement.
Ordinary Unix permission bits are preserved; setuid/setgid/sticky bits are never propagated.

Unix atomically renames the replacement over the executable while retaining `old-binary` and `old-receipt.json`.
Windows first renames the running executable to `running-binary` in the recovery directory, then moves the verified replacement into place.
The journal moves `preparing` -> `staged` -> `committed`; the receipt is replaced after the binary and the journal is marked committed last.
Failed replacement attempts restore both old executable and receipt from retained backups through fixed-name scratch files (`restore-binary.tmp`, `restore-receipt.tmp`) and mark the journal `restored`.
On Windows, restoration moves a present replacement aside to `failed-binary` only if that name does not already exist, so an earlier backup is never overwritten.
A successful rollback does not ask for `recover`; the next upgrade or cleanup removes the backup.
If rollback fails, the error names the executable, backup binary, backup receipt, and `running-binary` when it exists (Windows) for manual recovery.
A preparation failure leaves the executable untouched and removes the files this transaction created plus the directory; if that fails, the next upgrade or cleanup removes the attributable leftovers.

Only an inconsistent state, where the installed executable/receipt match neither the old nor the committed new state of the journal, blocks another update and asks for `recover`, including during check/dry-run.
Use `recover(original_executable_path, true)` only after explicit recovery confirmation; the original absolute path works even if the executable is temporarily absent.
Recovery takes the lock, validates journal path binding, backup hash, and old receipt before restoring, and refuses to overwrite an unrecognized modified executable.
Recovery preserves its backups and is resumable: after an interruption past the executable restore, running it again only restores the receipt, so an existing `failed-binary` is kept.

The parent may call `cleanup(executable_path)` on a later normal launch, but not during check/dry-run.
It takes the lock and removes only recognized validated backup/staging files from a committed, restored, or never-mutated transaction, and succeeds when there is nothing to clean.
Locked Windows backups are left for a retry with an explicit error.
Unknown entries, substituted backup bytes, symlinks, and uncommitted replacement states are preserved; nothing outside those files is deleted and directories are never removed recursively.
These guarantees concern normal I/O failures and process interruption, not a malicious process that can concurrently mutate the executable's directory, or power loss on every filesystem.

## Validation and platform limits

Windows-specific rename-aside/deferred-cleanup tests are gated by `cfg(windows)` and require execution on Windows before claiming native Windows validation.
Host-only tests claim no minimum OS version or cross-platform runtime execution.
Production signatures require maintainer key provisioning (see [release operations](../../docs/contributing/releasing.md)).

Direct `url` and `tempfile` pins, plus the `Cargo.lock` entries for the transitive `base64ct` 1.6.0 and `zeroize` 1.8.1, keep this crate buildable with Rust 1.83 (`--locked`).
Do not run a blanket `cargo update` without rechecking `cargo +1.83.0 build --locked`.
