# Module Architecture

This document maps the directories under `src/` and fixes the direction their
dependencies may point. Use it when you add a module and need to decide where it
belongs.

## Layers

A module may import only the layers listed for its directory, including its
own. Nothing below may import a layer above it.

| Directory     | Owns                                                                             | May import                           |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| `src/model/`  | Endpoints, links, diagnostics, scan results, and link manifest types; no I/O     | `model`                              |
| `src/shared/` | Small utilities: globbing, path order, package root, suggestions, source ranges  | `model`, `shared`                    |
| `src/config/` | Configuration, link manifest loading, language metadata, and managed-file lookup | `model`, `shared`, `config`          |
| `src/scan/`   | Markdown scanning and code scanning through each language adapter                | `model`, `shared`, `config`, `scan`  |
| `src/link/`   | Link resolution, the link graph, and applying manifest links to scan results     | `model`, `shared`, `link`            |
| `src/query/`  | The `check`, `related`, `context`, and `graph` workflows over a scanned project  | every layer above, and `query`       |
| `src/setup/`  | Initialization, skill installation, npm registry access, and update guidance     | `model`, `shared`, `config`, `setup` |

`src/link/` depends on the scan result types in `src/model/`, never on a
scanner. `src/query/` is where configuration, scanning, and link resolution are
combined.

## Entrypoints

`src/cli/` owns argument parsing, command dispatch, process exit codes, and
terminal output. `src/lsp/` owns the language server: transport, document state,
hover, navigation, and diagnostics. Both may import any layer; only `src/cli/`
imports `src/setup/`.

The two entrypoints are otherwise peers, with one edge between them:
`src/cli/index.ts` dispatches the `lsp` subcommand, so it imports
`src/lsp/server.ts`. Nothing under `src/lsp/` imports `src/cli/`.

The analysis layers, `src/model/` through `src/query/`, return data. Terminal
text for `check`, `related`, `context`, and `graph` is produced in
`src/cli/render/`, so the language server and scripts can reuse the same
results without a formatter in between.

`src/cli/index.ts` is the executable entrypoint. It starts the process,
dispatches subcommands, and owns `CliRuntime`. Command modules must not import
it; the shared write and read seams live in `src/cli/io.ts` instead.

## Code scanning

Code scanning is split so that a caller pays only for what it uses:

- `config/code-language.ts` holds language metadata and managed-file
  collection. Configuration validation and repository discovery depend on it
  without loading any parser or worker.
- `scan/code/dispatch.ts` binds each language to its adapter and dispatches
  scans. Importing it is what loads the TypeScript parser and the worker
  protocol. Callers can replace an adapter for one scan by argument.
- `scan/code/worker/scanner-executable.ts` finds the scanner worker binary for
  a source checkout or an installed package, and restores its executable bit.

`shared/package-root.ts` resolves the package directory that ships
`templates/skills`. The `docs` command, the setup commands, and scanner
discovery all need that path. Scanner discovery derives its source and dist
roots from it, so no module depends on its own depth below `src/`.

## Verification

`src/module-boundaries.test.ts` asserts these rules against the real import
graph, counting type-only imports. A misplaced module fails that test, so
rerun `just test` after moving one.
