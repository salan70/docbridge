# Module Architecture

This document maps the crates and modules of the Cargo workspace and the
direction their dependencies may point.

## Crates

| Crate              | Owns                                                                                           | Workspace deps |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------- |
| `crates/docbridge` | The `docbridge` executable and its library: commands, project scanning, queries, and lifecycle | none           |
| `crates/xtask`     | Unpublished repository gates, smoke checks, and release version maintenance                    | none           |

<!-- @code crates/docbridge/src/cli.rs -->
<!-- @code crates/docbridge/src/main.rs -->

## Entry point and commands

`main.rs` reads the process arguments, stdin, and the terminal confirmation,
and delegates everything else to the library. `cli.rs` owns argument parsing,
the `Command` enum, the `HELP` text, exit codes, and dispatch.

<!-- @code crates/docbridge/src/config.rs -->
<!-- @code crates/docbridge/src/project.rs -->
<!-- @code crates/docbridge/src/markdown.rs -->
<!-- @code crates/docbridge/src/model.rs -->

## Project model

- `config.rs` loads and validates `docbridge.config.json`, rejecting unknown
  keys.
- `project.rs` discovers the managed files under the selected root without
  following symlinks, parses each Markdown file, assigns section IDs, and
  resolves annotation targets.
- `markdown.rs` turns one Markdown file into sections and attached
  annotations, skipping fenced code, HTML comments, and raw HTML blocks.
  `model.rs` holds the types it returns.

These modules perform no output formatting.

<!-- @code crates/docbridge/src/query.rs -->
<!-- @code crates/docbridge/src/output.rs -->

## Queries and output

`query.rs` builds the `links` and `unlinked` graphs from a scanned project.
`output.rs` defines the graph and diagnostic types, their JSON serialization,
and the text rendering of a graph.

<!-- @code crates/docbridge/src/lifecycle.rs -->
<!-- @code crates/docbridge/src/cli_lifecycle.rs -->
<!-- @code crates/docbridge/src/docs.rs -->

## Lifecycle and guides

- `lifecycle.rs` implements `init` and `deinit`; `cli_lifecycle.rs` adapts it
  to the command line.
- `docs.rs` embeds the guides under `crates/docbridge/guides/` and serves
  `docbridge docs`.

<!-- @code crates/xtask/src/main.rs -->
<!-- @code crates/xtask/src/gates.rs -->
<!-- @code crates/xtask/src/smoke.rs -->
<!-- @code crates/xtask/src/release.rs -->

## Repository automation

`xtask` owns `agent-gate`, `publisher-gate`, `smoke`, and `release`. Both
crates inherit the root `Cargo.toml` `[workspace.package]` version, the only
version `release` sets. Only the product CLI is published.
