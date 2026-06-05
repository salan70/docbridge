# AGENTS.md

This file provides guidance for Codex when working in this repository.

## Skills

Codex skills live in `.agents/skills/`.

When the user mentions `grill-me`, `grill して`, `徹底的に詰めて`, or explicitly asks to deeply examine a plan or design, use `.agents/skills/grill-me/SKILL.md`.

## Language Policy

- Use Japanese for conversations with the user.
- Write deliverables in English by default, including documentation, code comments, commit messages, PR titles, and PR descriptions.
- Use Japanese only when the path or context explicitly identifies the content as Japanese, such as files under `docs/ja/`.

## Commit Policy

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does not add clarity.
- Split unrelated changes into separate commits.
