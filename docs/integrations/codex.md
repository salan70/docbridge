# Codex integration

How to give Codex DocBridge's link data through the distributable skill,
mirroring the [Claude Code integration](claude-code.md) in intent.

DocBridge does not ship agent hooks. Its guardrail belongs in Git hooks and CI,
where it applies to every contributor and every tool rather than to one agent
client; see [agent integration](../user/agent-integration.md) and the
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
