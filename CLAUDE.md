# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

This repo also ships an `AGENTS.md` for Codex and Codex assets under
`.agents/`, some of which Claude Code shares (see [Skills](#skills)). Treat `CLAUDE.md` plus `.claude/` as the Claude Code equivalents.
Keep the two stacks in sync in intent. `CLAUDE.md` and `AGENTS.md` address their
own tool and stay separate files; the skills under `.agents/skills/` and
`.claude/skills/` are shared content and stay identical (see [Skills](#skills)).

## Project Context

DocBridge is a TypeScript CLI that creates bidirectional links between code and
Markdown documentation. It scans TypeScript, Swift, Dart, and Rust code. It
parses `@doc` annotations in doc comments and `@code` annotations in Markdown
HTML comments, reads links declared in an optional `docbridge.links.json`
manifest, and reports diagnostics through `docbridge check`.

Repository layout:

- `src/` — the CLI, the TypeScript and Markdown scanners, the resolver, and the
  Language Server.
- `packages/` — the Swift, Dart, and Rust scanner workers.
- `editors/vscode/` — the VS Code-compatible extension.
- `docs/` — user guides (`docs/user/`, Japanese under `docs/ja/`),
  specifications (`docs/specs/`), integration recipes (`docs/integrations/`),
  contributor policy (`docs/contributing/`), decision records
  (`docs/decisions/`), implementation plans (`docs/plans/`, see
  [Plans](#plans)), and dated reports (`docs/reports/`).
  [docs/contributing/documentation.md](docs/contributing/documentation.md)
  owns what belongs where.
- `scripts/` — repository tooling called by `justfile` recipes.
- `.githooks/` — the shared Git `pre-commit` hook.

The `examples/` and `test-fixtures/` trees both hold small DocBridge projects but
differ by intended audience:

- `examples/` holds human-facing showcases meant to be read or copied: one
  per language (`examples/typescript`, `examples/swift`, `examples/dart`, `examples/rust`).
  These may also serve as integration test inputs; that reuse is intentional,
  not a reason to move them.
- `test-fixtures/` holds projects that exist solely to drive automated tests.
  Per-diagnostic fixtures live under `test-fixtures/diagnostics/`.

Distributable skill templates live under `templates/skills/`, and JSON schema
files live under `schemas/`.

Tests are colocated with the modules they cover as `*.test.ts` files under
`src/`; there is no separate `test/` directory. See
[docs/contributing/testing.md](docs/contributing/testing.md).

Development uses Bun; the published CLI runs on Node.js 22+ and Bun. Keep
dependencies minimal and prefer Bun plus the TypeScript Compiler API for core
implementation.

## Plans

Implementation plans live under `docs/plans/`. Each plan tracks its slices in a
`## Status` checklist.

- Active plans (any slice still unchecked) stay directly under `docs/plans/`.
- A plan is complete once every `## Status` checkbox is `[x]` and the work has
  merged to `main`. Completed plans are archived under `docs/plans/done/`.
- The PR that lands a plan's final slice is responsible for checking the last
  box, `git mv`-ing the plan into `docs/plans/done/`, and adding it to
  `docs/plans/done/README.md` in the same change, so the archive stays current
  without a separate sweep.

## Issues

The issue workflow in [CONTRIBUTING.md](CONTRIBUTING.md) applies to everyone.
When creating an issue, use the form that matches the work content and provide
its required information. Leave an optional field empty when it has no new
information. Non-trivial work begins only after the issue receives the `status:
accepted` label; the author or implementer identity is not an exception.

## Commands

Use the repo-native commands in `justfile` instead of ad-hoc shell invocations:

- `just setup` — install dependencies, build test scanner workers, and configure Git hooks
- `just doctor` — report tool versions and validate the required Swift version
- `just format` — apply all repository formatters
- `just format-check` — check formatting without modifying files
- `just lint` — run all repository linters
- `just lint-fix` — apply only Oxlint's safe fixes
- `just verify` — run the common read-only local quality gate
- `just check` — run the default DocBridge check
- `just check-example` — check the `examples/typescript` project
- `just check-example-json` — check the example with JSON output
- `just check-docs` — verify bilingual user-guide structure and local links
- `just check-ai-assets` — verify that the Claude and Codex skill trees agree
- `just prose-report <kind> <source>` — report advisory prose metrics
- `just audit` — run audit diagnostics
- `just check-audit-baseline` — compare live `--audit` keys against the committed
  repository baseline
- `just check-fixture <code>` — check one diagnostic fixture under
  `test-fixtures/diagnostics/`
- `just related-gate` — list linked counterparts of uncommitted and untracked
  changes; it does not cover changes that are already committed
- `just related-gate-report` — the pre-commit report over staged files,
  including counterpart content
- `just context` — print counterpart content for uncommitted changes
- `just test` — run the Bun test suite (`bun test`)
- `just build-test-scanners` — build the Swift, Dart, and Rust workers used by
  integration tests
- `just typecheck` — type-check the project (`tsc --noEmit`); catches type
  drift that `bun build` ignores
- `just build` — build the CLI with Bun
- `just install-git-hooks` — configure `core.hooksPath` for the shared hook

Run `just --list` for the remaining recipes: per-language scanner tests and
builds, example checks, packaging, and editor tooling.

If `just` is not on `PATH`, prefix commands with `nix develop -c` (for example,
`nix develop -c just check`). The dev shell is provided by `flake.nix` and
`.envrc` (`use flake`).

## Lint and Formatting Policy

`just verify` is the shared, read-only quality gate. It runs formatting checks,
lint, DocBridge checks, the documentation-structure and AI-asset checks, type
checking of the CLI and the editor extension, and tests over the whole
repository.
Hooks and CI must report violations, never modify files automatically.

Fix the underlying code instead of weakening a quality gate. Before doing any
of the following, Claude Code must obtain explicit user approval for the
specific exception:

- adding an inline lint or formatter suppression;
- disabling a rule or lowering its severity;
- expanding an ignore or exclusion;
- raising a complexity, file-size, function-size, depth, or parameter limit.

Approval for one exception does not authorize similar or broader exceptions.

## Local Guardrails

This repository has no agent hooks. Its guardrail is the Git `pre-commit` hook
under `.githooks/`, which applies to every contributor and every tool. Run
`just install-git-hooks` after cloning or when hook setup is missing; use
`nix develop -c just install-git-hooks` if `just` is not on `PATH`. The command
configures `core.hooksPath` for this repository.

The hook runs two stages:

- `just verify` as a mandatory, blocking guard. Fix the failure if this change
  caused it, then rerun the gate; if it cannot be fixed, report it explicitly.
- `just related-gate-report` over the staged files, which lists linked
  counterparts that were not staged and prints their content fetched via
  `docbridge context`. This stage is informational and never blocks the commit:
  either update each listed counterpart or state explicitly in the final report
  why it needs no update (use the `docbridge` skill for the triage). CI
  re-runs the gate over the whole PR change set and maintains a sticky PR
  comment; the human merge approval is the enforcement point.

Because nothing runs at turn end, run `just verify` yourself on changed work
before reporting completion.

## Skills

Project skills live in `.claude/skills/`. They are auto-discovered and can be
invoked directly with `/<skill-name>`.

- `tdd` — strict t-wada Red-Green-Refactor TDD for DocBridge. Use it when
  implementing features, fixing bugs, or refactoring logic. All logic changes
  must be test-first. Invoke with `/tdd` or when the task calls for test-driven
  development.
- `grill-me` — interrogate a plan or design one question at a time until shared
  understanding is reached. Use it with `/grill-me`, or when the user says
  `grill me`, `grill して`, `徹底的に詰めて`, or asks to deeply examine a plan
  or design.
- `pr-review` — review a pull request from the reviewer side: find real
  defects, verify them, and post actionable inline comments on the diff. Use it
  with `/pr-review`, or when asked to review a PR, inspect a PR for bugs, or
  post review findings.
- `git-workflow` — branch naming, PR-based flow, merge commits, branch
  protection, agent autonomy gates, and per-PR release labels.
  Use it with `/git-workflow`, or when branching, committing, pushing, opening
  or merging a PR, or choosing its release label.
- `review-response` — triage pull request review comments (from bots like Devin
  or human reviewers), act or justify per comment, then reply to and resolve
  every thread. Use it with `/review-response`, or when a PR has review feedback
  to address.
- `concise-writing` — create, compress, or review issues, pull request bodies,
  plans, documentation, and release notes without repeating facts owned by
  another artifact. Use it for those writing tasks and follow the canonical
  rules in `docs/contributing/writing.md`.
- `docbridge` — adopt DocBridge, choose docs and code scope, add `@doc` /
  `@code` annotations, fix link diagnostics, triage `related --gate` findings,
  and review existing links for stale docs or semantic validity. Use it with
  `/docbridge`, or when introducing DocBridge, linking code to its
  specification, or judging whether docs still match the code.

The distributable `docbridge` skill is a skill-level symlink from
`.claude/skills/docbridge` to `templates/skills/docbridge`. Apply edits to the
template; do not edit the symlink in place.

The repository-only `concise-writing` skill is shared from
`.agents/skills/concise-writing`; do not create a second copy for Claude.

Every other skill exists as a separate copy under `.agents/skills/` and
`.claude/skills/`. The two copies must stay byte-identical, so edit both in the
same change; `just check-ai-assets` fails when they differ. Tool-specific
guidance belongs in `CLAUDE.md` or `AGENTS.md`, never inside a skill body.

## Language Policy

- Write deliverables in English by default, including documentation, code
  comments, commit messages, PR titles, and PR descriptions.
- PR titles follow
  [docs/contributing/pull-requests.md](docs/contributing/pull-requests.md)
  (`<gitmoji> <type>: <summary>`, whole-PR summary, no scope, no issue number).
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
- Before creating a branch, sync local `main`: run `git switch main`, then
  `git pull --ff-only`. Never branch from a stale `main`. Name branches per
  [docs/contributing/pull-requests.md](docs/contributing/pull-requests.md)
  (`<feat|fix|chore>/#<issue>-<kebab-desc>`).
- After a PR merges, return to `main`, run `git pull --ff-only`, and delete the
  local branch before starting new work.
- Merge with **Create a merge commit** only; PR boundaries stay visible in
  `main` history.
- CI must pass before merging: `just format-check`, `just lint`, `just check`,
  `just check-ai-assets`, `just typecheck`, `just typecheck-extension`,
  `just test`, `just build`, and the native scanner and distribution checks in
  `.github/workflows/ci.yml`.
- Agents may branch, commit, push, and open PRs autonomously. **Merging a PR
  requires explicit human approval.** Merging a PR labeled `release: patch`,
  `release: minor`, or `release: major` publishes that release through GitHub
  Actions, so the merge is also the release approval gate.

### Commit messages

- Follow [docs/contributing/commits.md](docs/contributing/commits.md).
- Use English commit messages.
- Use the format `<gitmoji> <type>(<scope>): <summary>`; omit scope when it does
  not add clarity.
- Split unrelated changes into separate commits.
