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

Tests are colocated with the modules they cover as `*.test.ts` files under
`src/`; there is no separate `test/` directory. See
[docs/contributing/testing.md](docs/contributing/testing.md).

Use the repo-native commands in `justfile`:

- `just check`
- `just check-example`
- `just check-example-json`
- `just audit`
- `just test`
- `just build`

Runtime is Bun. Keep dependencies minimal and prefer Bun plus the TypeScript
Compiler API for core implementation.

## Local Guardrails

Codex hooks live under `.codex/`. The `SessionStart` hook injects a short
repository reminder, and the `Stop` hook runs `just check` and `just test` when
the working tree has changes. When those checks pass, the `Stop` hook also runs
`just related-gate`, which lists linked counterparts of the changed files that
were not themselves changed. If it blocks, either update each listed
counterpart or state explicitly in the final report why it needs no update.
The gate blocks once per turn; it asks for a judgment, not a mechanical fix.

Git hooks live under `.githooks/`. Run `just install-git-hooks` after cloning or
when hook setup is missing; use `nix develop -c just install-git-hooks` if
`just` is not on `PATH`. The command configures `core.hooksPath` for this
repository. The `pre-commit` hook runs `just check` and `just test` as a
mandatory guard.

## Skills

Codex skills live in `.agents/skills/`.

When the user mentions `grill-me`, `grill して`, `徹底的に詰めて`, or explicitly asks to deeply examine a plan or design, use `.agents/skills/grill-me/SKILL.md`.

When branching, committing, pushing, opening or merging a PR, or cutting a release, use `.agents/skills/git-workflow/SKILL.md`.

When a PR has review comments to triage, reply to, and resolve, use `.agents/skills/review-response/SKILL.md`.

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

## Git Policy

Full rules and the release procedure live in the `git-workflow` skill
(`.agents/skills/git-workflow/`). Always-on invariants:

- All changes land through a PR. Never push to `main` directly; GitHub blocks it for everyone, including administrators.
- Before creating a branch, sync local `main`: `git switch main && git pull --ff-only`. Never branch from a stale `main`. Name branches `feat/`, `fix/`, `chore/`, or `release/vX.Y.Z`.
- After a PR merges, return to an updated `main` (`git switch main && git pull --ff-only`) and delete the local branch before starting new work.
- Merge with **Create a merge commit** only; PR boundaries stay visible in
  `main` history.
- CI (`just check`, `just test`, `just build`) must pass before merging.
- Agents may branch, commit, push, and open PRs autonomously. **Merging a PR requires explicit human approval.** Release tagging and publishing are automated by GitHub Actions when the release PR is merged, so the merge is the release approval gate.

### Commit messages

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does not add clarity.
- Split unrelated changes into separate commits.
