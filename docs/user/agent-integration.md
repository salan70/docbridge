---
description: Wire DocBridge into coding agents, Git hooks, and CI.
---

# Agent Integration

DocBridge gives coding agents deterministic link data instead of asking them
to infer documentation relationships from filenames. An agent can do the whole
job from `docbridge --help` plus `docbridge docs list` / `docbridge docs show`.
A project skill is an accelerator, not a prerequisite.

<!-- @code src/cli/init.ts#runInitWithAgent -->

## Invoking DocBridge

Run DocBridge with the project's native invocation: `docbridge` on `PATH`, a
repo recipe such as `just check`, or
`bun run /path/to/docbridge/src/cli/index.ts`.

`docbridge init` can create `docbridge.config.json` and copy the distributable
`docbridge` skill for Codex, Claude Code, or both. To let an agent decide the
scope, run:

```sh
docbridge init-with-agent --agent-target codex
```

Use `claude` or `both` for other supported targets. The command installs the
skill and prints the next command or prompt; it does not launch an agent
process.

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

For every reported counterpart, choose one of three judgments:

- Update the counterpart when behavior, contract, format, or constraint
  diverged.
- Leave it unchanged, with a written justification that cites the counterpart
  content, when the change is internal and every documented statement still
  holds.
- Fix the link itself when the annotation pair points at the wrong section or
  symbol.

Do not detach a link only to silence the gate.

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

## Read more

Run `docbridge docs list` for the full menu of packaged guides, then
`docbridge docs show <name>` for a page. Start with `getting-started`,
`annotations`, `linking-workflow`, `link-review`, `troubleshooting`, and
`commands`.
