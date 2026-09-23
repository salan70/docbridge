# Codex integration

How to give Codex DocBridge's link data through the distributable skill,
mirroring the [Claude Code integration](claude-code.md) in intent.

DocBridge does not ship agent hooks. Its guardrail belongs in Git hooks and CI,
where it applies to every contributor and every tool rather than to one agent
client; see [automation](../user/automation.md) and the
[CI recipe](ci.md).

## Skills

[`templates/skills/`](../../templates/skills/) ships an agent skill that also
works as a Codex-style project skill. Install it with `docbridge init` or
`docbridge init-with-agent`, or copy `templates/skills/docbridge/` to
`.agents/skills/` when you prefer manual setup:

- `docbridge` — route adopt, discover-and-link, annotate, review, and sync
  work. Read `docbridge docs show` for annotation syntax, diagnostics, and
  workflows.

This repository keeps the distributable DocBridge skill canonical under
`templates/skills/` and dogfoods it as a skill-level symlink from
`.agents/skills/`. External repositories should usually copy the skill
directory so they remain self-contained.

A copied skill does not update with the package. After upgrading DocBridge,
run `docbridge upgrade --check` to compare the installed skill with the
packaged template, then `docbridge upgrade --force` to replace it. A skill
copied from 0.8.0 calls guide names that newer versions reject, so refresh it
before relying on it.
