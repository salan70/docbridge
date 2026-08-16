# Codex integration

How to give Codex DocBridge's link data through the distributable skills,
mirroring the [Claude Code integration](claude-code.md) in intent.

DocBridge does not ship agent hooks. Its guardrail belongs in Git hooks and CI,
where it applies to every contributor and every tool rather than to one agent
client; see [agent integration](../user/agent-integration.md) and the
[CI recipe](ci.md).

## Skills

[`templates/skills/`](../../templates/skills/) ships agent skills that also
work as Codex-style project skills. Install them with `docbridge init` (all
DocBridge skills) or `docbridge init-with-agent` (`docbridge-adopt` first;
`docbridge-adopt` installs the companion skills after scope is confirmed), or
copy individual skill directories to `.agents/skills/` when you prefer manual
setup:

- `docbridge-annotate` — create correct `@doc`/`@code` link pairs and verify
  them with `docbridge check`.
- `docbridge-sync` — triage `related --gate` findings using `docbridge context`,
  then update the counterpart or justify the divergence.
- `docbridge-adopt` — adopt DocBridge in an existing TypeScript, Swift, Dart, or Rust
  project by confirming docs/code scope, creating or improving config, and
  installing the companion DocBridge skills.
- `docbridge-link` — link existing docs sections to existing exported
  supported code declarations with section-level confirmation.
- `docbridge-review` — review all existing links for semantic validity using
  `docbridge graph --json --include-content`.

This repository keeps the distributable DocBridge skills canonical under
`templates/skills/` and dogfoods them as skill-level symlinks from
`.agents/skills/`. External repositories should usually copy the skill
directories so they remain self-contained.
