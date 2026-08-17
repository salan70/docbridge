# Claude Code integration

How to give [Claude Code](https://claude.com/claude-code) DocBridge's link data
through the distributable skill.

DocBridge does not ship agent hooks. Its guardrail belongs in Git hooks and CI,
where it applies to every contributor and every tool rather than to one agent
client; see [agent integration](../user/agent-integration.md) and the
[CI recipe](ci.md).

## Skills

[`templates/skills/`](../../templates/skills/) ships a Claude Code skill that
consumes the same commands. Install it with `docbridge init` or
`docbridge init-with-agent`, or copy `templates/skills/docbridge/` into
`.claude/skills/`:

- `docbridge` — route adopt, discover-and-link, annotate, review, and sync
  work. Read `docbridge docs show` for annotation syntax, diagnostics, and
  workflows.

Claude Code discovers project skills at `.claude/skills/<skill-name>/SKILL.md`.
This repository keeps the distributable DocBridge skill canonical under
`templates/skills/` and dogfoods it as a skill-level symlink from
`.claude/skills/`. External repositories should usually copy the skill
directory so they are not tied to this repository's checkout path.
