---
name: docbridge-adopt
description: Adopt DocBridge in an existing TypeScript, Swift, or Dart project. Use when asked to introduce DocBridge into a repository, choose docs/code scope, create or improve docbridge.config.json, and optionally wire simple CI or agent hooks.
---

# docbridge-adopt

Adopt DocBridge in an existing project. This skill assumes it is already
installed in the agent environment; installing agent skills into another
project is documented outside this skill.

The goal is to make the repository ready for DocBridge links, then continue
into an initial docs-first link-candidate pass. Do not assume a pull request.

Run DocBridge with the project's native invocation: `docbridge` on `PATH`, a
repo recipe such as `just check`, or
`bun run /path/to/docbridge/src/cli/index.ts`.

## Procedure

1. **Survey the repository.** Inspect:
   - existing `docbridge.config.json`
   - Markdown docs structure and likely specification directories
   - TypeScript, Swift, or Dart source structure and public API locations
   - existing `@doc` / `@code` annotations
   - package scripts, CI files, git hooks, and agent hooks

2. **Recommend scope, then ask for confirmation.** Present concise options and
   your recommendation for:
   - docs scope: directories/files whose sections are likely specifications,
     contracts, behavior, constraints, or design decisions
   - code scope: language-keyed TypeScript, Swift, or Dart directories/files
     whose supported declarations should be linkable
   - CI/hook mode: if any integration should be added now

   Do not ask the user to rediscover obvious facts from the repository. Show
   your recommendation and the tradeoff, then wait for confirmation.

3. **Create or improve config.**
   - If no config exists, create `docbridge.config.json` with the confirmed
     `include.code` and `include.docs` globs.
   - Use the language-keyed `include.code` object. Do not write the old
     array form; for example, use `{ "typescript": { "patterns": [...] } }`,
     `{ "swift": { "patterns": [...] } }`, or
     `{ "dart": { "patterns": [...] } }`.
   - If config exists, read it, explain the current scope, propose any
     improvement, and edit only after confirmation.
   - Never replace a user-authored config blindly.

4. **Handle CI/hooks conservatively.**
   - If the existing setup is simple and the user confirmed the mode, implement
     it.
   - If the setup is complex or ambiguous, provide a concrete patch plan or
     snippet instead of editing.
   - Prefer non-blocking awareness early in adoption unless the user requests a
     hard gate.

5. **Verify the setup.** Run `docbridge check` or the repository's equivalent.
   If the project intentionally has no links yet, a clean zero-link result is
   acceptable. Surface config or scanning diagnostics before proceeding.

6. **Continue into initial candidate discovery.** After setup, inspect the
   confirmed docs scope and present 5-10 high-value section candidates using
   the `docbridge-link` rules. Candidate discovery may continue in the same
   turn, but annotation edits still require section-level user confirmation.

## Scope Rules

- Prefer docs sections that state behavior, contracts, inputs/outputs,
  constraints, user-visible behavior, or design decisions.
- Treat README, changelogs, contribution docs, runbooks, logs, and release
  notes as exclusions by default unless the user identifies specific sections
  as specifications.
- Prefer supported public API declarations as link targets. TypeScript starts
  with top-level exported declarations; Swift and Dart also support member
  endpoints with scanner-produced canonical IDs.
- Do not decide project workflow policy such as branch or PR strategy. Mention
  only what affects DocBridge adoption.
