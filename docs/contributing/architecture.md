# Module Architecture

This document maps the crates and modules of the Cargo workspace and the
direction their dependencies may point. Use it when you add a module and need
to decide where it belongs.

## Crates

| Crate                      | Owns                                                                                           | Workspace deps     |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------ |
| `crates/docbridge`         | The `docbridge` executable and its library: commands, project scanning, queries, and lifecycle | `docbridge-update` |
| `crates/docbridge-update`  | Verified self-update of a standalone executable: release format, signatures, replacement       | none               |
| `crates/docbridge-release` | The unpublished maintainer tool that signs and verifies a release asset set                    | `docbridge-update` |
| `crates/xtask`             | Unpublished repository gates, smoke checks, and release version maintenance                    | none               |

`docbridge-update` never depends on the CLI, so the release tool verifies a
release with exactly the code that `docbridge upgrade` runs.

<!-- @code crates/docbridge/src/cli.rs -->
<!-- @code crates/docbridge/src/main.rs -->

## Entry point and commands

`main.rs` reads the process arguments, stdin, and the terminal confirmation,
and delegates everything else to the library. `cli.rs` owns argument parsing,
the `Command` enum, the `HELP` text, exit codes, and dispatch. Every command is
registered there.

<!-- @code crates/docbridge/src/config.rs -->
<!-- @code crates/docbridge/src/project.rs -->
<!-- @code crates/docbridge/src/markdown.rs -->
<!-- @code crates/docbridge/src/model.rs -->

## Project model

- `config.rs` loads and validates `docbridge.config.json`, rejecting unknown
  keys.
- `project.rs` discovers the managed files under the selected root without
  following symlinks, parses each Markdown file, assigns section IDs, and
  resolves annotation targets. It reports read, path, annotation, and link
  diagnostics.
- `markdown.rs` turns one Markdown file into sections and attached
  annotations, skipping fenced code, HTML comments, and raw HTML blocks.
  `model.rs` holds the types it returns.

These modules perform no output formatting.

<!-- @code crates/docbridge/src/query.rs -->
<!-- @code crates/docbridge/src/output.rs -->

## Queries and output

`query.rs` builds the `links` and `unlinked` graphs from a scanned project,
including merged content blocks. `output.rs` defines the graph and diagnostic
types, their JSON serialization, and the text rendering of a graph.

<!-- @code crates/docbridge/src/lifecycle.rs -->
<!-- @code crates/docbridge/src/cli_lifecycle.rs -->
<!-- @code crates/docbridge/src/docs.rs -->
<!-- @code crates/docbridge/src/cli_upgrade.rs -->

## Lifecycle, guides, and upgrade

- `lifecycle.rs` implements `init` and `deinit`: the embedded Skill and its
  ownership record, the removal plan, and atomic rewrites with a recovery
  directory. `cli_lifecycle.rs` adapts it to the command line.
- `docs.rs` embeds the guides under `crates/docbridge/guides/` with
  `include_str!` and serves `docbridge docs`.
- `cli_upgrade.rs` adapts `docbridge-update` to the `upgrade` command.

<!-- @code crates/xtask/src/main.rs -->
<!-- @code crates/xtask/src/gates.rs -->
<!-- @code crates/xtask/src/smoke.rs -->
<!-- @code crates/xtask/src/release.rs -->

## Repository automation

`xtask` owns `agent-gate`, `publisher-gate`, `smoke`, `release-label`, and `release-bump`.
Run it from the checkout with `cargo run --quiet --locked -p xtask --target-dir .tmp/rust-vnext -- <command>`; `just` and workflows use this same interface.
The agent and publisher regression tests run once as part of the Cargo workspace tests in `just verify`.
Version maintenance names exactly four manifests: `docbridge`, `docbridge-update`, `docbridge-release`, and `xtask`.
Only the product CLI and update library are published; repository automation adds no product command or API.

## Verification

Behavior is tested at each crate boundary; see [Verification](README.md#verification). Clippy
runs with `-D warnings` over every target through `just lint`.
