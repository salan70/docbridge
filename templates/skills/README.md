# SpecLink skill templates

Distributable agent skills for projects that use SpecLink. Installation is
copy-based: copy a skill directory into your repository's skill location
(`.claude/skills/` for Claude Code) and adjust nothing unless your SpecLink
invocation differs from the examples inside.

- [`speclink-annotate`](speclink-annotate/SKILL.md) — create correct
  `@doc`/`@code` link pairs and verify them with `speclink check`.
- [`speclink-sync`](speclink-sync/SKILL.md) — triage `related --gate`
  findings: fetch the flagged counterpart content with `speclink context`,
  then update the counterpart or justify leaving it unchanged.

This repository installs the same skills into its own `.claude/skills/`;
keep the two copies identical when editing (the template is the source of
truth). Codex equivalents will follow once the Claude versions settle.

The hook-side integration that complements these skills lives in
[`examples/hooks/`](../../examples/hooks/) with recipes under
[`docs/integrations/`](../../docs/integrations/).
