# Codex integration

How to give Codex DocBridge's link data through the distributable skill,
mirroring the [Claude Code integration](claude-code.md) in intent. The general
agent, hook, and CI policy is in [automation](../user/automation.md); this page
covers only Codex specifics.

## Skills

[`templates/skills/`](../../templates/skills/) ships the `docbridge` skill,
which routes adopt, discover-and-link, annotate, review, and sync work and
reads `docbridge docs show` for annotation syntax, diagnostics, and workflows.
It works as a Codex project skill under `.agents/skills/`. Install it there
with an explicit target:

```sh
docbridge init --agent-target codex
```

To have Codex choose the initial documentation and code scope, run
`docbridge init-with-agent --agent-target codex` instead. Use `both` to also
install the skill for Claude Code. For manual setup, copy
`templates/skills/docbridge/` to `.agents/skills/`.

This repository keeps the distributable DocBridge skill canonical under
`templates/skills/` and dogfoods it as a skill-level symlink from
`.agents/skills/`. External repositories should usually copy the skill
directory so they remain self-contained.

## Keep the skill current

A copied skill does not update with the package. After upgrading DocBridge,
compare it with the packaged template:

```sh
docbridge upgrade --check --agent-target codex
```

Replacing a stale skill is covered in the `upgrade` section of
[Commands](../user/commands.md#upgrade-keep-the-cli-and-skills-in-step).
