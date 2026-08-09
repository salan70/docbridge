# Claude Code integration

How to give [Claude Code](https://claude.com/claude-code) DocBridge's link data
through the distributable skills.

DocBridge does not ship agent hooks. Its guardrail belongs in Git hooks and CI,
where it applies to every contributor and every tool rather than to one agent
client; see [agent integration](../user/agent-integration.md) and the
[CI recipe](ci.md).

## Skills

[`templates/skills/`](../../templates/skills/) ships Claude Code skills that
consume the same commands. Install them with `docbridge init` (all DocBridge
skills) or `docbridge init-with-agent` (`docbridge-adopt` first;
`docbridge-adopt` installs the companion skills after scope is confirmed), or
copy the skills you want into your repository's `.claude/skills/` directory:

- `docbridge-annotate` — create correct `@doc`/`@code` link pairs and verify
  them with `docbridge check`.
- `docbridge-sync` — triage `related --gate` findings using `docbridge context`,
  then update the counterpart or justify the divergence.
- `docbridge-adopt` — adopt DocBridge in an existing TypeScript, Swift, or Dart
  project by confirming docs/code scope, creating or improving config, and
  installing the companion DocBridge skills.
- `docbridge-link` — link existing docs sections to existing exported
  supported code declarations with section-level confirmation.
- `docbridge-review` — review all existing links for semantic validity using
  `docbridge graph --json --include-content`.

Claude Code discovers project skills at `.claude/skills/<skill-name>/SKILL.md`.
This repository keeps the distributable DocBridge skills canonical under
`templates/skills/` and dogfoods them as skill-level symlinks from
`.claude/skills/`. External repositories should usually copy the skill
directories so they are not tied to this repository's checkout path.
