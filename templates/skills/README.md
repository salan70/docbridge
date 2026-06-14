# SpecLink skill templates

Distributable agent skills for projects that use SpecLink. Installation is
copy-based: copy a skill directory into your repository's skill location
(`.claude/skills/` for Claude Code or `.agents/skills/` for Codex-style
project skills) and adjust nothing unless your SpecLink invocation differs
from the examples inside.

- [`speclink-annotate`](speclink-annotate/SKILL.md) — create correct
  `@doc`/`@code` link pairs and verify them with `speclink check`.
- [`speclink-sync`](speclink-sync/SKILL.md) — triage `related --gate`
  findings: fetch the flagged counterpart content with `speclink context`,
  then update the counterpart or justify leaving it unchanged.
- [`speclink-adopt`](speclink-adopt/SKILL.md) — adopt SpecLink in an existing
  TypeScript project by confirming docs/code scope, creating or improving
  config, and handling simple CI/hook setup.
- [`speclink-link`](speclink-link/SKILL.md) — link existing docs sections to
  existing exported TypeScript symbols through docs-first candidate discovery
  and section-level confirmation.
- [`speclink-review`](speclink-review/SKILL.md) — review the whole SpecLink
  graph for semantic validity using `speclink graph --json --include-content`.

This repository dogfoods the distributable SpecLink skills from both
`.claude/skills/` and `.agents/skills/` as skill-level symlinks to this
directory. The template is the source of truth; do not edit the symlinked
copies in place. In-repository dogfood links require symlink-capable checkouts;
external projects should use the copy-based installation above.

The hook-side integration that complements these skills lives in
[`examples/hooks/`](../../examples/hooks/) with recipes under
[`docs/integrations/`](../../docs/integrations/).
