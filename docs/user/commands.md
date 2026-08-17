---
description: Choose between check, related, context, and graph.
---

# Commands

Use the narrowest command for the question you need to answer.

<!-- @code src/cli/index.ts#run -->

## Command dispatch

The first argument selects a command. Global `--help` and `--version` are
handled before project scanning, while each command validates its own options.

<!-- @code src/cli/index.ts#run -->

### `check`: validate the project

Run `docbridge check` before committing and in CI. It validates configuration,
annotations, targets, and reciprocal links. Add `--audit` to include warnings
for undocumented code declarations and unlinked Markdown sections. Add
`--json` for machine-readable diagnostics.

<!-- @code src/core/related.ts#related -->

### `related`: find counterpart files

Pass changed paths to learn which linked files may also need attention:

```sh
git diff --name-only | docbridge related --stdin
```

`--gate` exits `1` when a linked counterpart is absent from the supplied change
set. It identifies review obligations; it does not decide whether the
counterpart actually needs an edit.

<!-- @code src/core/context.ts#context -->

### `context`: read counterpart content

Use `context` when a human or agent needs the linked sections themselves:

```sh
docbridge context src/auth.ts
```

The default Markdown output is suitable for an agent prompt. `--json` returns
structured contexts, diagnostics, and a summary.

<!-- @code src/core/graph-output.ts#graph -->

### `graph`: inspect link structure

Use `graph` for endpoints, edges, reciprocal pairs, and unresolved links across
the project. Passing file paths scopes the result to those files and their
direct counterparts. `--include-content` is available only with `--json`.

## Common options

The project commands accept `--root <path>` when invoked outside the project
root. Run `docbridge <command> --help` for the exact options and exit behavior
of a command.
