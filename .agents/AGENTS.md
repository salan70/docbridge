# AGENTS.md

This file provides guidance for Codex when working with AI assets under `.agents/`.

## Working Rules

- Codex skills live in `.agents/skills/`.
- Treat `.agents/skills/` as the active skill directory. Its child skill
  entries may be symlinks to `templates/skills/`; edit the template source, not
  the symlinked copy.
- Do not copy Claude-specific instructions directly into Codex assets.
