# Claude Code integration

How to give [Claude Code](https://claude.com/claude-code) DocBridge's link data
through the distributable skill. The general agent, hook, and CI policy is in
[automation](../user/automation.md); this page covers only Claude Code
specifics.

## Skills

[`templates/skills/`](../../templates/skills/) ships the `docbridge` skill,
which routes adopt, discover-and-link, annotate, review, and sync work and
reads `docbridge docs show` for annotation syntax, diagnostics, and workflows.
Claude Code discovers project skills at `.claude/skills/<skill-name>/SKILL.md`.
Install the skill there with an explicit target:

```sh
docbridge init --agent-target claude
```

To have Claude Code choose the initial documentation and code scope, run
`docbridge init-with-agent --agent-target claude` instead. Use `both` to also
install the skill for Codex. For manual setup, copy
`templates/skills/docbridge/` into `.claude/skills/`.

This repository keeps the distributable DocBridge skill canonical under
`templates/skills/` and dogfoods it as a skill-level symlink from
`.claude/skills/`. External repositories should usually copy the skill
directory so they are not tied to this repository's checkout path.

## Keep the skill current

A copied skill does not update with the package. After upgrading DocBridge,
compare it with the packaged template:

```sh
docbridge upgrade --check --agent-target claude
```

Replacing a stale skill is covered in the `upgrade` section of
[Commands](../user/commands.md#upgrade-keep-the-cli-and-skills-in-step).
