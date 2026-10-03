# CLAUDE.md

<!-- The shared rules live in AGENTS.md, imported below. Add only Claude Code
specifics here; `just check-ai-assets` rejects a copy of the shared body. -->

@AGENTS.md

## Claude Code specifics

- Claude Code does not read `.agents/`. Each `.claude/skills/<name>` entry is a
  symlink that resolves to the same source as `.agents/skills/<name>`.
- `.claude/settings.json` holds the shared permission rules, such as the
  approval prompt for `gh pr merge`.
