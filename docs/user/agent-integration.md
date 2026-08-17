---
description: Wire DocBridge into coding agents, Git hooks, and CI.
---

# Agent Integration

DocBridge gives coding agents deterministic link data instead of asking them
to infer documentation relationships from filenames.

<!-- @code src/cli/init.ts#runInitWithAgent -->

## Install agent skills

`docbridge init` can install the distributable skills while creating project
configuration. To let an agent decide the scope, run:

```sh
docbridge init-with-agent --agent-target codex
```

Use `claude` or `both` for other supported targets. The command installs the
adoption skill and prints the next command or prompt; it does not launch an
agent process.

<!-- @code src/core/context.ts#context -->
<!-- @code src/core/related.ts#related -->

## Editing workflow

Before changing a linked file, provide its counterpart content:

```sh
docbridge context path/to/changed-file
```

After editing, inspect the change set:

```sh
git diff --name-only | docbridge related --stdin --gate
```

For every reported counterpart, update it when behavior diverged or record why
no documentation or code change is necessary.

## Hooks

Put the automation in Git hooks rather than in one agent's configuration, so
it covers every contributor and every tool. A `pre-commit` hook can run
`docbridge check` as a hard gate, then report `related --gate` over the staged
files:

```sh
git diff --cached --name-only | docbridge related --stdin --gate
```

When an agent runs `git commit` through a shell, the hook's output lands in the
tool result and therefore in the agent's context, so the counterpart findings
reach it without any agent-specific wiring. Attach the counterparts' content
with `docbridge context --stdin` to make the finding actionable in place.

Keep the gate stage non-blocking while the link graph is still sparse: a
blocking gate on a staged subset mostly trains `--no-verify`. Hooks must not
silently rewrite files or replace the repository's mandatory checks.

Git hooks cannot signal before an edit, and they are skipped by `--no-verify`
and by some GUI clients, so the pull request stays the enforcement point.

## CI

Run `docbridge check` over the whole project as the hard link-validity gate. A
pull-request workflow can additionally pass the base-to-head changed file list
to `related --stdin --gate` and attach `context` output for reviewers. Ensure
the checkout includes both commits needed for the diff.
