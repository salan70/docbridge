---
description: Wire DocBridge into coding agents, hooks, and CI.
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

Agent hooks are advisory automation around the same commands. An edit hook can
run `context` to surface linked content. A stop hook can run `check`, then
`related --gate` over changed files. Hooks must not silently rewrite files or
replace the repository's mandatory checks.

## CI

Run `docbridge check` over the whole project as the hard link-validity gate. A
pull-request workflow can additionally pass the base-to-head changed file list
to `related --stdin --gate` and attach `context` output for reviewers. Ensure
the checkout includes both commits needed for the diff.
