# AGENTS.md

This file provides guidance for Codex when working in this repository.

## Project Context

SpecLink is a Bun and TypeScript CLI that creates bidirectional links between
TypeScript code and Markdown documentation. It parses `@doc` annotations in
JSDoc and `@code` annotations in Markdown HTML comments, then reports
diagnostics through `speclink check`.

Core implementation lives under `src/`. Specifications live under `docs/specs/`,
Japanese documentation lives under `docs/ja/`, examples live under `examples/`,
and JSON schema files live under `schemas/`.

Use the repo-native commands in `justfile`:

- `just check`
- `just check-example`
- `just check-example-json`
- `just audit`
- `just test`
- `just build`

Runtime is Bun. Keep dependencies minimal and prefer Bun plus the TypeScript
Compiler API for core implementation.

## Skills

Codex skills live in `.agents/skills/`.

When the user mentions `grill-me`, `grill して`, `徹底的に詰めて`, or explicitly asks to deeply examine a plan or design, use `.agents/skills/grill-me/SKILL.md`.

When working under `.agents/`, also follow `.agents/AGENTS.md`.

## Language Policy

- Write deliverables in English by default, including documentation, code comments, commit messages, PR titles, and PR descriptions.
- Use Japanese only when the path or context explicitly identifies the content as Japanese, such as files under `docs/ja/`.

## Communication Policy

- Use the same language as the user for conversations with the user.
- Do not optimize for empathy or reassurance.
- Prioritize accuracy, rationality, and concise reasoning.
- State direct opinions when they are technically relevant.
- Surface risks, weak assumptions, and tradeoffs plainly.

## Completion Reports

When reporting completion to the user, explicitly list:

- Skills used, or `None`.
- MCP servers/tools used, or `None`.

## Commit Policy

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does not add clarity.
- Split unrelated changes into separate commits.
