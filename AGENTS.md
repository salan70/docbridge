# AGENTS.md

This file holds the shared guidance for coding agents working in this
repository. Codex reads it directly. Claude Code reads `CLAUDE.md`, which
imports this file with `@AGENTS.md` and adds only Claude Code specifics. Keep
this body tool-neutral, put Codex specifics under
[Codex-specific guidance](#codex-specific-guidance), and never copy shared rules
into `CLAUDE.md`; `just check-ai-assets` rejects a copy.

## Project Context

DocBridge is a TypeScript CLI that creates bidirectional links between code and
Markdown documentation. It scans TypeScript, JavaScript, Swift, Dart, Rust, Go,
Python, Ruby, and Java code. It parses `@doc` annotations in doc comments and
`@code` annotations in Markdown HTML comments, reads links declared in an
optional `docbridge.links.json` manifest, and reports diagnostics through
`docbridge check`.

Repository layout:

- `src/` — the CLI, the TypeScript and Markdown scanners, the resolver, and the
  Language Server.
- `packages/` — the Swift, Dart, Rust, Go, Python, Ruby, and Java scanner
  workers.
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

- `examples/` holds human-facing showcases meant to be read or copied: one per
  language (`examples/typescript`, `examples/javascript`, `examples/swift`,
  `examples/dart`, `examples/rust`, `examples/go`, `examples/python`,
  `examples/ruby`, `examples/java`). These may also serve as integration test
  inputs; that reuse is intentional, not a reason to move them.
- `test-fixtures/` holds projects that exist solely to drive automated tests.
  Per-diagnostic fixtures live under `test-fixtures/diagnostics/`.

Distributable skill templates live under `templates/skills/`, and JSON schema
files live under `schemas/`.

Tests are colocated with the modules they cover as `*.test.ts` files; there is
no separate `test/` directory. See
[docs/contributing/testing.md](docs/contributing/testing.md).

Development uses Bun; the published CLI runs on Node.js 22+ and Bun. Keep
dependencies minimal and prefer Bun plus the TypeScript Compiler API for core
implementation.

## Plans

Implementation plans live under `docs/plans/` and track their slices in a
`## Status` checklist.

- Active plans (any slice still unchecked) stay directly under `docs/plans/`.
- A plan is complete once every `## Status` checkbox is `[x]` and the work has
  merged to `main`; completed plans are archived under `docs/plans/done/`.
- The PR that lands a plan's final slice checks the last box, `git mv`-es the
  plan into `docs/plans/done/`, and adds it to `docs/plans/done/README.md` in
  the same change, so the archive stays current without a separate sweep.

## Issues

Issues are optional. When you open one, follow
[CONTRIBUTING.md](CONTRIBUTING.md#issues).

## Commands

Use the repo-native recipes in `justfile` (`just --list`) instead of ad-hoc
shell invocations. `just setup` prepares a fresh checkout, and `just verify` is
the local quality gate. If `just` is not on `PATH`, prefix commands with
`nix develop -c` (for example, `nix develop -c just verify`).

To run the DocBridge CLI from this checkout, including the `docbridge docs show`
commands that the `docbridge` skill suggests, use `bun run src/cli/index.ts` in
place of `docbridge`.

## Lint and Formatting Policy

`just verify` is the shared, read-only quality gate. It runs formatting checks,
lint, DocBridge checks, the documentation-structure and AI-asset checks, type
checking of the CLI and the editor extension, and tests over the whole
repository. Run `just format` to apply deterministic formatting and
`just lint-fix` to apply only Oxlint's safe fixes; hooks and CI must never
modify files automatically.

Fix the underlying code instead of weakening a quality gate. Before doing any
of the following, an AI agent must obtain explicit user approval for the
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

All logic changes must be test-first; use the `tdd` skill.

Each skill has one source. `.agents/skills/<name>` holds it, and
`.claude/skills/<name>` is a symlink to it. The distributable `docbridge`
skill's source is `templates/skills/docbridge`, which both trees link to.
`just check-ai-assets` enforces this layout. Keep skill bodies tool-neutral;
tool-specific guidance belongs in this file's Codex section or in `CLAUDE.md`,
never in a skill.

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

Branching, commits, pull requests, and releases follow the `git-workflow`
skill (`.agents/skills/git-workflow/SKILL.md`). Always-on invariants:

- All changes land through a PR; never push to `main` directly.
- Branch from an up-to-date `main` (`git switch main && git pull --ff-only`).
- Agents may branch, commit, push, and open PRs autonomously. **Merging a PR
  requires explicit human approval.** Merging a PR labeled `release: patch`,
  `release: minor`, or `release: major` publishes that release, so the merge is
  also the release approval gate.

## Codex-specific guidance

Codex loads the project rules in `.codex/rules/` only when this project is
trusted.
