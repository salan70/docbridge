## Project overrides (DocBridge)

Read `.agents/rules/pstack.md` first; it overrides this skill.

- There is no `comment-sicko` subagent type. Spawn `general-purpose` per `.agents/rules/pstack.md` and paste the brief at `tool/pstack/upstream/agents/comment-sicko.md` into its prompt, adding that `/why` means reading `.agents/skills/why/SKILL.md`.
- `/why` and `/architect` are installed. Read `.agents/skills/why/SKILL.md` or `.agents/skills/architect/SKILL.md` directly; the `Skill` tool refuses most pstack skills.
- `principle-redesign-from-first-principles` is not installed. Skip a step that names a missing skill with one line, per `.agents/rules/pstack.md`.
