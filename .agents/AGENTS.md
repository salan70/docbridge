# AGENTS.md

This file provides guidance for Codex when working with AI assets under `.agents/`.

## Working Rules

- Codex skills live in `.agents/skills/`.
- Treat `.agents/skills/` as the active skill directory. Its child skill
  entries may be symlinks to `templates/skills/`; edit the template source, not
  the symlinked copy.
- Keep `.agents/skills/concise-writing/` tool-neutral because Claude shares it
  through `.claude/skills/concise-writing`.
- Keep every other skill byte-identical to its copy under `.claude/skills/`.
  Edit both copies in the same change; `just check-ai-assets` fails when they
  differ.
- Keep skill bodies tool-neutral. Codex-specific guidance belongs in `AGENTS.md`,
  not in a skill.
