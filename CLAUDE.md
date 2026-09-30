# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.
The shared, tool-neutral rules live in `AGENTS.md`, which Codex reads directly
and this file imports below. Edit shared rules there, never here: this file adds
only Claude Code specifics, and `just check-ai-assets` rejects a copy of the
shared body.

@AGENTS.md

## Claude Code specifics

- `.claude/` holds the Claude Code counterparts of the Codex assets under
  `.agents/`.
- Project skills in `.claude/skills/` are auto-discovered. Each is a symlink to
  its source under `.agents/skills/`, as the shared Skills rules describe.
