# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

This repo also ships an `AGENTS.md` for Codex and Codex-specific assets under
`.codex/` and `.agents/`. Treat `CLAUDE.md` plus `.claude/` as the
Claude Code equivalents. Keep the two stacks in sync in intent, but do not copy
Claude-specific instructions into Codex assets or vice versa.

## Project Context

SpecLink is a Bun and TypeScript CLI that creates bidirectional links between
TypeScript code and Markdown documentation. It parses `@doc` annotations in
JSDoc and `@code` annotations in Markdown HTML comments, then reports
diagnostics through `speclink check`.

Core implementation lives under `src/`. Specifications live under `docs/specs/`,
Japanese documentation lives under `docs/ja/`, examples live under `examples/`,
and JSON schema files live under `schemas/`.

Runtime is Bun. Keep dependencies minimal and prefer Bun plus the TypeScript
Compiler API for core implementation.

## Commands

Use the repo-native commands in `justfile` instead of ad-hoc shell invocations:

- `just check` — run the default SpecLink check
- `just check-example` — check the `examples/basic` project
- `just check-example-json` — check the example with JSON output
- `just audit` — run audit diagnostics
- `just test` — run the Bun test suite (`bun test`)
- `just build` — build the CLI with Bun

If `just` is not on `PATH`, prefix commands with `nix develop -c` (for example,
`nix develop -c just check`). The dev shell is provided by `flake.nix` and
`.envrc` (`use flake`).

## Local Guardrails

Claude Code hooks are configured in `.claude/settings.json` and live under
`.claude/hooks/`:

- The `SessionStart` hook injects a short repository reminder as additional
  context.
- The `Stop` hook runs `just check` and `just test` when the working tree has
  changes, and blocks completion with the failure output if either fails. Fix
  the failure if this change caused it, then rerun the checks; if it cannot be
  fixed this turn, report it explicitly.

Git hooks live under `.githooks/`. Run `just install-git-hooks` after cloning or
when hook setup is missing; use `nix develop -c just install-git-hooks` if `just`
is not on `PATH`. The command configures `core.hooksPath` for this repository.
The `pre-commit` hook runs `just check` and `just test` as a mandatory guard.

## Skills

Project skills live in `.claude/skills/`. They are auto-discovered and can be
invoked directly with `/<skill-name>`.

- `tdd` — strict t-wada Red-Green-Refactor TDD for SpecLink. Use it when
  implementing features, fixing bugs, or refactoring logic. All logic changes
  must be test-first. Invoke with `/tdd` or when the task calls for test-driven
  development.
- `grill-me` — interrogate a plan or design one question at a time until shared
  understanding is reached. Use it with `/grill-me`, or when the user says
  `grill me`, `grill して`, `徹底的に詰めて`, or asks to deeply examine a plan
  or design.
- `git-workflow` — branch naming, PR-based flow, merge commits, branch
  protection, agent autonomy gates, and the semi-automated release procedure.
  Use it with `/git-workflow`, or when branching, committing, pushing, opening
  or merging a PR, or cutting a release.
- `review-response` — triage pull request review comments (from bots like Devin
  or human reviewers), act or justify per comment, then reply to and resolve
  every thread. Use it with `/review-response`, or when a PR has review feedback
  to address.

## Language Policy

- Write deliverables in English by default, including documentation, code
  comments, commit messages, PR titles, and PR descriptions.
- Use Japanese only when the path or context explicitly identifies the content
  as Japanese, such as files under `docs/ja/`.

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

## Git Policy

Full rules and the release procedure live in the `git-workflow` skill
(`.claude/skills/git-workflow/`). Always-on invariants:

- All changes land through a PR. Never push to `main` directly; GitHub blocks it
  for everyone, including administrators.
- Before creating a branch, sync local `main`: `git switch main && git pull
  --ff-only`. Never branch from a stale `main`. Name branches `feat/`, `fix/`,
  `chore/`, or `release/vX.Y.Z`.
- After a PR merges, return to an updated `main` (`git switch main && git pull
  --ff-only`) and delete the local branch before starting new work.
- Merge with **Create a merge commit** only; PR boundaries stay visible in
  `main` history.
- CI (`just check`, `just test`, `just build`) must pass before merging.
- Agents may branch, commit, push, and open PRs autonomously. **Merging a PR and
  pushing tags require explicit human approval.**

### Commit messages

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does
  not add clarity.
- Split unrelated changes into separate commits.
