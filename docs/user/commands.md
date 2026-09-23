---
description: Choose between check, related, context, graph, docs, and upgrade.
---

# Commands

Use the narrowest command for the question you need to answer.

<!-- @code src/cli/index.ts#run -->

## Command dispatch

The first argument selects a command. Global `--help` and `--version` are
handled before project scanning, while each command validates its own options.

<!-- @code src/core/resolver.ts#check -->

### `check`: validate the project

Run `docbridge check` before committing and in CI. It validates configuration,
annotations, targets, reciprocal links, and the optional link manifest. Add
`--audit` to include warnings for undocumented code declarations and unlinked
Markdown sections. Add `--json` for machine-readable diagnostics.

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

<!-- @code src/cli/upgrade.ts#runUpgrade -->

### `upgrade`: keep the CLI and skills in step

Run `docbridge upgrade --check` after a DocBridge release, or whenever a
project still carries agent assets from an older layout:

```sh
docbridge upgrade --check
```

It is read-only. It reports the installed version, the latest stable release on
npm, the command to upgrade the CLI with your package manager, the state of the
managed `docbridge` skill, any leftover legacy skill directories, symlinks, and
files you have edited locally.

DocBridge never upgrades itself and never runs a package manager for you.
Upgrade the CLI with the printed command, then re-run `docbridge upgrade` so the
managed skill is reconciled from the new binary:

```sh
docbridge upgrade --dry-run
docbridge upgrade --force --yes
```

`--dry-run` prints the full plan without writing files. Without `--force`, an
existing skill directory is preserved and the migration is reported as pending.
`--force` replaces the managed `docbridge` skill and removes only the five known
legacy skill directories, and only when they are ordinary directories reached
through ordinary directories. A symlink, a regular file carrying a legacy name,
and anything under a symlinked `.agents/skills` or `.claude/skills` are reported
and left alone. Replacing the skill reproduces the packaged template exactly, so
a file you added inside it does not survive `--force`; keep local notes outside
the managed directory, or make it a symlink to a copy you own. Destructive operations ask for confirmation unless `--yes` is
passed, and a non-interactive run without `--yes` fails instead of replacing
local edits. Configuration, hooks, CI recipes, and your own files are never
touched.

## Update notification

On an interactive terminal, DocBridge prints one line to stderr when a newer
stable release is available. The check uses a short timeout and a daily
per-user cache, fails silently when offline, and never changes a command's
stdout or exit code. It is suppressed in CI, for `--json` output, for the
language server, when output is redirected, and when
`DOCBRIDGE_NO_UPDATE_CHECK=1` is set. That variable also stops `upgrade` from
contacting the registry, so it reports the latest version as unknown and only
describes local asset state.

## Common options

The project commands accept `--root <path>` when invoked outside the project
root. Run `docbridge <command> --help` for the exact options and exit behavior
of a command.

## Documentation commands

Use `docbridge docs list` to see the version-matched guides installed with the
CLI and `docbridge docs show <name>` to print one. The canonical names are
`getting-started`, `configuration`, `linking`, `commands`, `automation`, and
`troubleshooting`.

## Next steps

- Read `docbridge docs show linking` before creating or reviewing a pair.
- Read `docbridge docs show automation` before adding repository automation.
- Read `docbridge docs show troubleshooting` when a command reports a failure.
- Run `docbridge upgrade --check` after upgrading the CLI.
