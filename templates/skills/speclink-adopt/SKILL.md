---
name: speclink-adopt
description: Adopt SpecLink in an existing TypeScript project. Use when asked to introduce SpecLink into a repository, choose docs/code scope, create or improve speclink.config.json, and optionally wire simple CI or agent hooks.
---

# speclink-adopt

Adopt SpecLink in an existing project. This skill assumes it is already
installed in the agent environment; installing agent skills into another
project is documented outside this skill.

The goal is to make the repository ready for SpecLink links, then continue
into an initial docs-first link-candidate pass. Do not assume a pull request.

Run SpecLink with the project's native invocation: `speclink` on `PATH`, a
repo recipe such as `just check`, or
`bun run /path/to/spec-link/src/cli/index.ts`.

## Procedure

1. **Survey the repository.** Inspect:
   - existing `speclink.config.json`
   - Markdown docs structure and likely specification directories
   - TypeScript source structure and exported API locations
   - existing `@doc` / `@code` annotations
   - package scripts, CI files, git hooks, and agent hooks

2. **Recommend scope, then ask for confirmation.** Present concise options and
   your recommendation for:
   - docs scope: directories/files whose sections are likely specifications,
     contracts, behavior, constraints, or design decisions
   - code scope: TypeScript directories/files whose exported declarations
     should be linkable
   - CI/hook mode: if any integration should be added now

   Do not ask the user to rediscover obvious facts from the repository. Show
   your recommendation and the tradeoff, then wait for confirmation.

3. **Create or improve config.**
   - If no config exists, create `speclink.config.json` with the confirmed
     `include.code` and `include.docs` globs.
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

5. **Verify the setup.** Run `speclink check` or the repository's equivalent.
   If the project intentionally has no links yet, a clean zero-link result is
   acceptable. Surface config or scanning diagnostics before proceeding.

6. **Continue into initial candidate discovery.** After setup, inspect the
   confirmed docs scope and present 5-10 high-value section candidates using
   the `speclink-link` rules. Candidate discovery may continue in the same
   turn, but annotation edits still require section-level user confirmation.

## Scope Rules

- Prefer docs sections that state behavior, contracts, inputs/outputs,
  constraints, user-visible behavior, or design decisions.
- Treat README, changelogs, contribution docs, runbooks, logs, and release
  notes as exclusions by default unless the user identifies specific sections
  as specifications.
- Prefer exported top-level TypeScript declarations as link targets.
- Do not decide project workflow policy such as branch or PR strategy. Mention
  only what affects SpecLink adoption.
