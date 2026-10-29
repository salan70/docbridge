# Testing Convention

DocBridge is a Cargo workspace. `just test` runs
`cargo test --workspace --locked`, and `just verify` composes it with the
formatting, lint, and self-validation gates.

## Test placement

- Put behavior tests at the crate boundary, in `crates/<crate>/tests/*.rs`.
  `crates/docbridge/tests/` runs the built binary
  (`env!("CARGO_BIN_EXE_docbridge")`) or calls the library API, and asserts
  output, exit codes, and JSON shape.
- Keep a `#[cfg(test)] mod tests` inside a module only for private helpers that
  the public boundary cannot reach.
- Put a fixture project that a test copies under
  `crates/<crate>/tests/fixtures/<name>/`. Markdown lint and formatting skip
  `crates/docbridge/tests/fixtures/`, so a fixture can hold deliberately
  invalid or legacy input.
- Prefer a scratch project written by the test itself in a temporary directory
  when a few files are enough.

## Release scripts

The shell scripts under `scripts/` are tested from
`crates/docbridge-release/tests/`. Each test copies or runs the script with
stub `gh`, `git`, `cargo`, or `od` executables first on `PATH`, so no test
touches GitHub, the network, or a real key. The tests are Unix-only
(`#![cfg(unix)]`).

## Toolchain

The Rust toolchain is pinned by `rust-toolchain.toml` (1.83.0). The Nix dev
shell provides it, and CI installs the same version on each platform.

## Release binary smoke

`just smoke` builds the release binary for this machine and runs
`scripts/smoke-vnext.sh` on it: the binary must start, show the offline
guides, and handle a representative `validate`, `links`, and `unlinked` flow
in a throwaway project. CI runs the same script on the binary of each of the
five release targets.

## Repository self-validation

`just validate` runs `docbridge validate`, built from this checkout, on the
repository itself, and `just verify` includes it. `just unlinked` and
`just links` are informational; see [Self-audit](self-audit.md).

## Notes

- For logic changes, write tests first (see the `tdd` skill).
