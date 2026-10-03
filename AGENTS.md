# AGENTS.md

Shared guidance for coding agents in this repository. Codex reads this file
directly; Claude Code reads it through the `@AGENTS.md` import in `CLAUDE.md`.
Keep it tool-neutral and put Codex specifics under
[Codex-specific guidance](#codex-specific-guidance). `CLAUDE.md` adds only
Claude Code specifics, and `just check-ai-assets` rejects a copy of this body
there.

## Project Context

DocBridge is a TypeScript CLI that links code declarations and Markdown
documentation in both directions. It reads `@doc` annotations in doc comments,
`@code` annotations in Markdown HTML comments, and an optional
`docbridge.links.json` manifest, and `docbridge check` reports the diagnostics.
It scans TypeScript and JavaScript itself, and Swift, Dart, Rust, Go, Python,
Ruby, and Java through the scanner workers under `packages/`.
[docs/contributing/documentation.md](docs/contributing/documentation.md) owns
where each kind of documentation belongs.

`examples/` and `test-fixtures/` both hold small DocBridge projects.
`examples/` holds one human-facing showcase per language, meant to be read or
copied; tests may also use them, which is not a reason to move them.
`test-fixtures/` holds projects that exist only to drive automated tests.

Tests sit next to the modules they cover as `*.test.ts` files; see
[docs/contributing/testing.md](docs/contributing/testing.md). Development uses
Bun; the published CLI runs on Node.js 22+ and Bun. Keep dependencies minimal
and prefer Bun and the TypeScript Compiler API for core implementation.

## Commands

Use the repo-native recipes in `justfile` (`just --list`) instead of ad-hoc
shell invocations. `just setup` prepares a fresh checkout. If `just` is not on
`PATH`, prefix commands with `nix develop -c` (for example,
`nix develop -c just verify`). If a tool is missing although `IN_NIX_SHELL` is
set, the shell holds a stale environment; run the command through
`nix develop -c` as well.

To run the DocBridge CLI from this checkout, including the `docbridge docs show`
commands that the `docbridge` skill suggests, use `bun run src/cli/index.ts` in
place of `docbridge`.

## Quality Gates

`just verify` is the shared, read-only quality gate. Run `just format` to apply
deterministic formatting and `just lint-fix` to apply only Oxlint's safe fixes;
hooks and CI never modify files.

Fix the underlying code instead of weakening a quality gate. Get explicit user
approval for the specific exception before you:

- add an inline lint or formatter suppression;
- disable a rule or lower its severity;
- expand an ignore or exclusion;
- raise a complexity, file-size, function-size, depth, or parameter limit.

Approval for one exception does not authorize similar or broader exceptions.

The repository has no agent hooks. Its guardrail is the Git `pre-commit` hook
under `.githooks/`; run `just install-git-hooks` after cloning or when the hook
is not set up. The hook runs two stages:

- `just verify`, which blocks the commit. It checks the working tree, not only
  the staged snapshot. Fix a failure that this change caused and rerun; report
  one that you cannot fix.
- `just related-gate-report` over the staged files, which lists linked
  counterparts that were not staged, with their content. It never blocks:
  update each listed counterpart or state in the final report why it needs no
  update (the `docbridge` skill covers the triage). CI repeats the gate over
  the whole pull request.

Run `just verify` on changed work before reporting completion, even when you
have not committed.

## Skills

Logic changes are test-first; follow the `tdd` skill. A user's explicit
instruction overrides a skill's default behavior, but not the approval
requirements in this file.

Each skill has one source under `.agents/skills/<name>`, and
`.claude/skills/<name>` is a symlink to it. The distributable `docbridge`
skill's source is `templates/skills/docbridge`, which both trees link to.
`just check-ai-assets` enforces this layout and each skill's frontmatter. Keep
skill bodies tool-neutral; tool-specific guidance belongs in the Codex section
here or in `CLAUDE.md`.

## Plans, Issues, and Pull Requests

- Implementation plans under `docs/plans/` follow the lifecycle in
  [docs/contributing/writing.md](docs/contributing/writing.md#implementation-plans).
  The pull request that lands a plan's final slice also archives the plan.
- Issues are optional. When you open one, follow
  [CONTRIBUTING.md](CONTRIBUTING.md#issues).
- Pull request titles follow
  [docs/contributing/pull-requests.md](docs/contributing/pull-requests.md).

## Language and Communication

- Write deliverables in English, including documentation, code comments,
  commit messages, and pull requests. Use Japanese only where the path or
  context marks the content as Japanese, such as files under `docs/ja/`.
- Talk with the user in the user's language. Favor accuracy and concise
  reasoning over reassurance, and state technical opinions, risks, weak
  assumptions, and tradeoffs plainly.

## Completion Reports

When you report completion to the user, list the skills and the MCP servers or
tools you used, or `None` for each.

## Git Policy

Branching, commits, pull requests, and releases follow the `git-workflow`
skill. These invariants always apply:

- Every change lands through a pull request; never push to `main`.
- Branch from a freshly fetched `origin/main`:
  `git fetch origin && git switch --no-track -c <branch> origin/main`.
- Agents may branch, commit, push, and open pull requests. **Merging a pull
  request requires explicit human approval.** Merging one labeled
  `release: patch`, `release: minor`, or `release: major` also publishes that
  release.

## Codex-specific guidance

Codex loads the project rules in `.codex/rules/` only when this project is
trusted.
