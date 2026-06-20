# DocBridge skill templates

Distributable agent skills for projects that use DocBridge. Installation is
copy-based: copy a skill directory into your repository's skill location
(`.claude/skills/` for Claude Code or `.agents/skills/` for Codex-style
project skills) and adjust nothing unless your DocBridge invocation differs
from the examples inside.

- [`docbridge-annotate`](docbridge-annotate/SKILL.md) — create correct
  `@doc`/`@code` link pairs and verify them with `docbridge check`.
- [`docbridge-sync`](docbridge-sync/SKILL.md) — triage `related --gate`
  findings: fetch the flagged counterpart content with `docbridge context`,
  then update the counterpart or justify leaving it unchanged.
- [`docbridge-adopt`](docbridge-adopt/SKILL.md) — adopt DocBridge in an existing
  TypeScript, Swift, or Dart project by confirming docs/code scope, creating
  or improving config, and handling simple CI/hook setup.
- [`docbridge-link`](docbridge-link/SKILL.md) — link existing docs sections to
  existing supported code declarations through docs-first candidate discovery
  and section-level confirmation.
- [`docbridge-review`](docbridge-review/SKILL.md) — review the whole DocBridge
  graph for semantic validity using `docbridge graph --json --include-content`.

This repository dogfoods the distributable DocBridge skills from both
`.claude/skills/` and `.agents/skills/` as skill-level symlinks to this
directory. The template is the source of truth; do not edit the symlinked
copies in place. In-repository dogfood links require symlink-capable checkouts;
external projects should use the copy-based installation above.

The hook-side integration that complements these skills lives in
[`examples/hooks/`](../../examples/hooks/) with recipes under
[`docs/integrations/`](../../docs/integrations/).
