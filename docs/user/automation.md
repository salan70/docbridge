---
description: Automate DocBridge with coding agents, Git hooks, and CI.
---

# Automation

Use automation after `docbridge check` passes locally. Keep link validity as a
hard gate, and treat unchanged linked counterparts as review obligations rather
than automatic failures.

<!-- @code src/cli/init.ts#runInitWithAgent -->

## Invoking DocBridge

Run DocBridge through the project's normal command: `docbridge` on `PATH`, a
package-manager script, or a repository recipe such as `just check`. An agent
can discover the interface from `docbridge --help` and the packaged guides from
`docbridge docs list`.

Keep the DocBridge version in one place, such as the package manifest's
development dependency or a single version file that hooks and CI read. When
the same pin is copied into several scripts, the copies drift apart. After
changing the version, run `docbridge upgrade --check` to confirm that the CLI
and the installed skill match; see `docbridge docs show commands`.

`docbridge init` can create `docbridge.config.json` and install the
distributable `docbridge` skill for Codex, Claude Code, or both. To have an
agent choose the initial documentation and code scope, run:

```sh
docbridge init-with-agent --agent-target codex
```

Use `claude` or `both` for the other supported targets. The command installs
the skill and prints the next command or prompt; it does not launch an agent.

<!-- @code src/core/context.ts#context -->
<!-- @code src/core/related.ts#related -->

## Editing workflow

Before editing a linked file, read its counterpart:

```sh
docbridge context path/to/file
```

After editing, inspect the change set:

```sh
git diff --name-only | docbridge related --stdin --gate
```

For every reported counterpart, make one explicit judgment:

- update it when behavior, contract, format, or constraints changed;
- leave it unchanged with a written, content-based justification when every
  documented statement still holds; or
- fix the annotation pair when the link points to the wrong section or symbol.

Never remove a valid link just to silence the gate.

## Git hooks

Put shared checks in repository hooks rather than one agent's configuration.
A pre-commit hook can run `docbridge check` as a blocking validity gate and
then report related files from the staged set:

```sh
git diff --cached --name-only | docbridge related --stdin --gate
```

Add `docbridge context --stdin` when the report should include counterpart
content. Keep the related-file stage informational while the graph is sparse;
hooks must not rewrite files or replace the repository's normal quality gates.
Hooks can be bypassed, so pull-request CI remains the enforcement point.

## Continuous integration

Run `docbridge check` over the whole project as the hard link-validity gate. A
pull-request workflow can also pass the base-to-head file list to
`related --stdin --gate` and attach `context` output for reviewers. Fetch enough
Git history for the comparison and calculate the changed paths from the PR's
base and head commits.

The general contract belongs here. Copyable GitHub Actions steps and sticky PR
comment behavior belong in the [CI integration recipe](https://github.com/salan70/docbridge/blob/main/docs/integrations/ci.md).

## Agent-specific recipes

The distributable skill is under
[`templates/skills/docbridge`](https://github.com/salan70/docbridge/tree/main/templates/skills/docbridge).
The recipes below live in the repository, not in the installed package. For
client setup and prompt examples, use the specialized recipes:

- [Claude Code](https://github.com/salan70/docbridge/blob/main/docs/integrations/claude-code.md)
- [Codex](https://github.com/salan70/docbridge/blob/main/docs/integrations/codex.md)
- [CI](https://github.com/salan70/docbridge/blob/main/docs/integrations/ci.md)

## Next steps

- Read `docbridge docs show commands` for command output and exit behavior.
- Read `docbridge docs show linking` before adding or reviewing links.
- Read `docbridge docs show troubleshooting` when an automated check fails.
