# AGENTS.md

This file provides guidance for Codex when working in this repository.

## Project Context

DocBridge is a Bun and TypeScript CLI that creates bidirectional links between
TypeScript code and Markdown documentation. It parses `@doc` annotations in
JSDoc and `@code` annotations in Markdown HTML comments, then reports
diagnostics through `docbridge check`.

Core implementation lives under `src/`. Specifications live under `docs/specs/`,
Japanese documentation lives under `docs/ja/`, AI integration recipes live
under `docs/integrations/`, and implementation plans live under `docs/plans/`
(see [Plans](#plans)).

The `examples/` and `test-fixtures/` trees both hold small DocBridge projects but
differ by intended audience:

- `examples/` holds human-facing showcases meant to be read or copied: one per
  language (`examples/typescript`, `examples/swift`, `examples/dart`) plus
  copyable agent hook scripts in `examples/hooks/`. These may also serve as
  integration test inputs; that reuse is intentional, not a reason to move them.
- `test-fixtures/` holds projects that exist solely to drive automated tests.
  Per-diagnostic fixtures live under `test-fixtures/diagnostics/`.

Distributable skill templates live under `templates/skills/`, and JSON schema
files live under `schemas/`.

Tests are colocated with the modules they cover as `*.test.ts` files under
`src/`; there is no separate `test/` directory. See
[docs/contributing/testing.md](docs/contributing/testing.md).

Use the repo-native commands in `justfile`:

- `just setup`
- `just doctor`
- `just format`
- `just format-check`
- `just lint`
- `just lint-fix`
- `just verify`
- `just check`
- `just check-example`
- `just check-example-json`
- `just audit`
- `just check-fixture <code>`
- `just test`
- `just typecheck`
- `just build`

Runtime is Bun. Keep dependencies minimal and prefer Bun plus the TypeScript
Compiler API for core implementation.

## Lint and Formatting Policy

`just verify` is the shared, read-only quality gate. It runs formatting checks,
lint, DocBridge checks, type checking, and tests over the whole repository. Run
`just format` to apply deterministic formatting and `just lint-fix` to apply
only Oxlint's safe fixes; hooks and CI must never modify files automatically.

Fix the underlying code instead of weakening a quality gate. Before doing any
of the following, an AI agent must obtain explicit user approval for the
specific exception:

- adding an inline lint or formatter suppression;
- disabling a rule or lowering its severity;
- expanding an ignore or exclusion;
- raising a complexity, file-size, function-size, depth, or parameter limit.

Approval for one exception does not authorize similar or broader exceptions.

## Plans

Implementation plans live under `docs/plans/` and track their slices in a
`## Status` checklist.

- Active plans (any slice still unchecked) stay directly under `docs/plans/`.
- A plan is complete once every `## Status` checkbox is `[x]` and the work has
  merged to `main`; completed plans are archived under `docs/plans/done/`.
- The PR that lands a plan's final slice checks the last box and `git mv`-es the
  plan into `docs/plans/done/` in the same change, so the archive stays current
  without a separate sweep.

## Issues

The issue workflow in [CONTRIBUTING.md](CONTRIBUTING.md) applies to everyone.
When creating an issue, use the form that matches the work content and provide
all of its fields. Non-trivial work begins only after the issue receives the
`status: accepted` label; the author or implementer identity is not an
exception.

## Local Guardrails

Codex hooks live under `.codex/` (`hooks.json` plus scripts in
`.codex/hooks/`). Codex loads project-local hooks only after they are reviewed
and trusted with the `/hooks` command, and a hook must be re-trusted whenever
its script changes. If hooks do not appear to fire, check `/hooks` first. Treat
these hooks as best-effort awareness; the hard guards are the `pre-commit` git
hook and CI.

The `SessionStart` hook injects a short repository reminder. The `PostToolUse`
hook (Edit/Write) surfaces the linked counterpart content of the file just
edited via `docbridge context` so the change can be reconciled against it; it is
`PostToolUse` rather than `PreToolUse` because a `PreToolUse` hook's additional
context is delivered only after the edit runs, and files without linked
counterparts inject nothing. The `Stop` hook runs `just verify` when the working
tree has changes, and blocks completion with the failure output if it fails; on
continuation turns it re-runs the gate and reports
the result without blocking again. When the gate passes, it also reports
`just related-gate` results over uncommitted changes as information, attaching
the flagged counterparts' content fetched via `docbridge context` and delivered
as Stop `additionalContext` (not a user-facing `systemMessage`): either update
each listed counterpart or state explicitly in the final report why it needs no
update. CI re-runs the gate over the whole PR change set and maintains a sticky
PR comment; the human merge approval is the enforcement point.

Git hooks live under `.githooks/`. Run `just install-git-hooks` after cloning or
when hook setup is missing; use `nix develop -c just install-git-hooks` if
`just` is not on `PATH`. The command configures `core.hooksPath` for this
repository. The `pre-commit` hook runs `just verify` as a mandatory guard.

## Skills

Codex skills live in `.agents/skills/`.

When the user mentions `grill-me`, `grill して`, `徹底的に詰めて`, or explicitly asks to deeply examine a plan or design, use `.agents/skills/grill-me/SKILL.md`.

When the user asks to review a PR, inspect a PR for defects, or post review findings, use `.agents/skills/pr-review/SKILL.md`.

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
- CI must pass `just format-check`, `just lint`, `just check`, `just typecheck`,
  `just test`, and `just build` before merging.
- Agents may branch, commit, push, and open PRs autonomously. **Merging a PR requires explicit human approval.** Release tagging and publishing are automated by GitHub Actions when the release PR is merged, so the merge is the release approval gate.

### Commit messages

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does not add clarity.
- Split unrelated changes into separate commits.
