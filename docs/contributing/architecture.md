# Module Architecture

This document maps the four directories under `src/` and fixes the direction
their dependencies may point. Use it when you add a module and need to decide
where it belongs.

## Layers

Dependencies point downward only. A module may import from its own layer and
from any layer below it, never from a layer above.

| Layer       | Directory    | Owns                                                                           |
| ----------- | ------------ | ------------------------------------------------------------------------------ |
| Entrypoints | `src/cli/`   | Argument parsing, command dispatch, process exit codes, and terminal output    |
|             | `src/lsp/`   | The language server: transport, document state, hover, navigation, diagnostics |
| Setup       | `src/setup/` | Initialization, skill installation, npm registry access, and update guidance   |
| Core        | `src/core/`  | Scanning, link resolution, diagnostics, and the utilities those need           |

Both entrypoints may import `src/core/`, and `src/cli/` may also import
`src/setup/`. `src/setup/` may import `src/core/` and nothing above it.

The two entrypoints are otherwise peers, with one edge between them:
`src/cli/index.ts` dispatches the `lsp` subcommand, so it imports
`src/lsp/server.ts`. Nothing under `src/lsp/` imports `src/cli/`.

## Core

`src/core/` answers what the project contains and whether its links resolve. It
splits code scanning into three modules so that a caller pays only for what it
uses:

- `code-language.ts` holds language metadata and managed-file collection. It
  imports no adapter, parser, or worker. Configuration validation and
  repository discovery depend on this module alone.
- `code-scan.ts` binds each language to its adapter and dispatches scans.
  Importing it is what loads the TypeScript parser and the worker protocol.
- `scanner-executable.ts` finds the scanner worker binary for a source checkout
  or an installed npm package, and restores its executable bit.

`package-root.ts` resolves the package directory that ships `templates/skills`.
The `docs` command and the setup commands both need that path, so it stays
independent of initialization planning.

`scanner-executable.ts` derives the source root as its own directory's
grandparent. Keep it exactly one directory below `src/`, or source-mode scanner
discovery breaks.

## Setup

`src/setup/` holds the modules behind `docbridge init` and `docbridge upgrade`.
They cover repository discovery, initialization and upgrade planning, managed
skill assets, npm registry lookups, the update-check cache, and upgrade
guidance. These change for different reasons than scanning does, which is why
they do not live in `src/core/`.

## Entrypoints

`src/cli/index.ts` is the executable entrypoint. It starts the process,
dispatches subcommands, and owns `CliRuntime`. Command modules must not import
it; the shared write and read seams live in `src/cli/io.ts` instead.

## Verification

`src/module-boundaries.test.ts` asserts these rules against the real import
graph, counting type-only imports. A misplaced module fails that test, so
rerun `just test` after moving one.
