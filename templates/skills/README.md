# DocBridge skill templates

Distributable agent skill for projects that use DocBridge. Prefer
`docbridge init` for CLI-driven setup or `docbridge init-with-agent` for
agent-guided adoption. Both commands install the same `docbridge` skill.
Manual copy-based installation remains available: copy the skill directory
into your repository's skill location (`.claude/skills/` for Claude Code or
`.agents/skills/` for Codex-style project skills).

- [`docbridge`](docbridge/SKILL.md) — route adopt, discover-and-link, annotate,
  review, and sync work. Facts about the binary live in
  `docbridge docs show`, not in this file.

This repository dogfoods the distributable DocBridge skill from both
`.claude/skills/` and `.agents/skills/` as skill-level symlinks to this
directory. The template is the source of truth; do not edit the symlinked
copies in place. In-repository dogfood links require symlink-capable checkouts;
external projects should use the copy-based installation above.

Existing installs may still have the five legacy skill directories
(`docbridge-adopt`, `docbridge-annotate`, `docbridge-link`,
`docbridge-review`, `docbridge-sync`). `docbridge init --force` removes those
copied directories after you review local edits. Symlinked skill directories
are reported and left untouched.

The Git-hook and CI integration that complements this skill is described
under [`docs/integrations/`](../../docs/integrations/).
