# Contributing to DocBridge

Thank you for improving DocBridge. This guide is the canonical entry point for
setting up the repository, making a change, and preparing a pull request.

## Development environment

DocBridge is a Rust Cargo workspace (`crates/`). The recommended environment is
the pinned Nix development shell. It provides the Rust toolchain pinned by
`rust-toolchain.toml`, `just`, and every formatter and linter used by the
shared quality gate. Install a flake-enabled Nix distribution and optionally
[direnv](https://direnv.net/) before cloning the repository.

Without Nix, use `flake.nix` as the authoritative tool list and install all of
its packages yourself. The repository does not maintain a second set of
unpinned setup instructions.

## Setup

Clone the repository, then enter the development environment with direnv:

```sh
direnv allow
```

Alternatively, enter it explicitly:

```sh
nix develop
```

Configure the repository Git hooks:

```sh
just setup
```

From outside the development shell, use:

```sh
nix develop -c just setup
```

Confirm that the required tools are visible:

```sh
just doctor
```

The setup command configures `core.hooksPath` as `.githooks`. The pre-commit
hook runs the read-only `just verify` gate and never modifies files.

To run the CLI from this checkout, use `cargo run -p docbridge --` in place of
`docbridge`, for example for the `docbridge docs show` commands that the
`docbridge` skill suggests:

```sh
cargo run -p docbridge -- docs show linking
```

`just validate`, `just links`, and `just unlinked` run the matching commands on
this repository.

Coding agents read `AGENTS.md`. This repository keeps exactly two canonical
skills, `docbridge` and `git-workflow`, in `.agents/skills/`.
The whole `.claude/skills` directory is a symlink to `../.agents/skills`, so both
agent paths share one physical tree. `just lint-ai-assets` enforces this layout.
On Windows, a checkout with `core.symlinks=false` produces a text file instead
of the alias and fails this gate. Enable Git symlink checkout with the required
OS permissions and check out the alias again; there is no silent copy fallback.

The product's `docbridge init --claude` behavior remains separate: it installs
managed copies for consumer projects. Do not run `init --force --claude` in
this repository: the product rejects write paths through symlinks.
After changing the distributable skill embedded in
`crates/docbridge/src/lifecycle.rs`, regenerate only the canonical copy with
`cargo run -p docbridge -- init --force --yes`; retain the whole-directory alias.
Keep skill bodies tool-neutral.

## Issues

Issues are optional. Open one to report a problem, to propose a change, or to
agree on scope before you invest in a large change. Choose the form by the type
of work:

| Work                                                                                    | Issue form      |
| --------------------------------------------------------------------------------------- | --------------- |
| Reproducible incorrect behavior or regression                                           | Bug report      |
| Feature, technical design, API, build, dependency, documentation, or maintenance change | Change proposal |

Provide the form's required information and follow the
[Documentation](#documentation). Each form field owns
distinct information; link to an existing fact instead of paraphrasing it.

## Making a change

1. Start from an up-to-date `main` branch and create a focused branch. Name it
   using the convention below
   (`<feat|fix|chore>/#<issue>-<kebab-desc>`, without `#<issue>` when no issue
   exists).
2. Keep code, tests, specifications, and user documentation consistent. For
   each file or section you change, `just links <path> --include-content` shows
   its linked counterparts; update them or confirm that they still agree.
3. For logic changes, write the failing test first and follow the conventions
   below.
4. Apply deterministic formatting with `just format`.
5. Run the relevant focused checks while iterating, then run the shared gates
   before opening a pull request.

Do not weaken a formatter, linter, complexity limit, or exclusion to make a
change pass. Fix the underlying issue instead.

## Verification

Run the common read-only gate:

```sh
just verify
```

It runs formatting checks, lint (Clippy, rumdl, ShellCheck, Nix, actionlint,
and the skill layout), the workspace tests, and `docbridge validate` on this
repository. Also smoke-test the release binary for this machine:

```sh
just smoke
```

Run additional checks when the affected area requires them:

| Area                | Commands                                     |
| ------------------- | -------------------------------------------- |
| Nix package         | `nix build .#docbridge`, `just flake-check`  |
| Release label       | `just check-release-label "release: <kind>"` |
| Repository coverage | `just unlinked`                              |
| Linked counterparts | `just links <path> --include-content`        |

CI runs `just verify`, then builds, tests, and smoke-runs the five release
targets and signs them with a throwaway key; see
[Releasing](releasing.md#dry-run).

Use `just --list` for the complete task list. If a command must be run outside
an activated shell, prefix it with `nix develop -c`.

## Git and pull requests

Every change lands through a pull request and a merge commit after required CI passes.
Agents require explicit human approval to merge; merging publishes nothing.
Use `<feat|fix|chore>/#<issue>-<kebab-desc>` for branches, omitting `#<issue>-` when no issue exists.
Dependabot branch names are exempt; encode `#` as `%23` in handwritten branch URLs.

Commit subjects use `<gitmoji> <type>(<optional-scope>): <summary>`.
PR titles use `<gitmoji> <type>: <summary>`, without a scope or issue number, and describe the whole PR.
Write imperative English summaries without a trailing period, under 72 characters when practical.
Use `feat` (✨), `fix` (🐛), `docs` (📝), `style` (💄), `refactor` (♻️), `perf` (⚡️), `test` (✅), `build` (📦), `ci` (👷), `chore` (🔧), or `revert` (⏪).
Keep unrelated changes separate; retain generated Dependabot titles.
Explain nonobvious reasons, tradeoffs, or migration details in the body.
Breaking changes use `!` after the type/scope and a `BREAKING CHANGE:` footer.
Branch names and titles are conventions, not CI-enforced checks.

Follow the PR template and summarize delivered results in at most three bullets.
Record only checks actually run, remaining risks, deviations, and actual linked-counterpart findings.
Link resolved issues using plain-text closing keywords such as Closes #123, outside code spans or fences.
Without an issue, state the problem solved.

Every PR requires exactly one label: `release: none`, `release: patch`, `release: minor`, or `release: major`.
A releasing label requires `just release-bump <kind>` and its version/CHANGELOG changes in the same PR.
The required `release-label` check enforces this; a maintainer separately dispatches Release vNext.
See [release operations](releasing.md) for publication and key management.

## Documentation

Write repository artifacts in English with concrete actions, clear prerequisites, and one main idea per sentence.
Lead with the result; preserve safety, compatibility, failure, and verification constraints.
Keep one authoritative explanation per fact and link to it instead of copying it.
Issues own problems and acceptance criteria; PRs own delivered results and verification; CHANGELOG owns user-visible release history.
Plans are optional when significant decisions or sequencing remain; current documentation describes current behavior.
Review prose for supported, necessary claims, clear terms, descriptive links, and duplication.

| Location                            | Owns                                             |
| ----------------------------------- | ------------------------------------------------ |
| `README.md`                         | Installation, readiness, and routes to guides    |
| `crates/docbridge/guides/`          | Canonical offline user tasks                     |
| `docs/specs/vnext-contracts.md`     | Single developer behavior contract               |
| `docs/contributing/README.md`       | Contributor workflow and documentation policy    |
| `docs/contributing/architecture.md` | Module responsibilities and dependencies         |
| `docs/contributing/releasing.md`    | Detailed release operations and pending work     |
| `crates/docbridge-update/README.md` | Signed format, installer API, receipts, recovery |

Embedded guides link only to each other by filename because `docbridge docs` prints them without a checkout.
They have no active `@code` annotations and stay outside `include.docs`.
Keep the distributable Skill thin; guides own user detail.
Link normative sections and design references to the Rust file implementing them, using `@code` before a heading.
Tests, re-export modules, process prose, and overviews can remain unlinked; zero unlinked items is not a goal.
Run `just links <path> --include-content` for changed linked sections and confirm agreement or update counterparts.
`just validate` checks structure, not meaning.
`just lint-markdown` checks Markdown and local links; `just verify` includes both checks.
Historical CHANGELOG links remain unchanged even when their targets have retired.

### Test conventions

Write a regression test before a bug fix or logic change and observe its failure
for the expected reason before implementing the smallest passing change.
Refactor only while green. Behavior-preserving refactors need no new failing
test when coverage exists; otherwise add a characterization test first.
Test one externally visible behavior per test, preferring public interfaces.
Never delete, skip, or weaken tests to pass; explain corrections to wrong tests.
Avoid content-existence tests that merely freeze wording. Keep setup and
literals local to each test when that improves readability.
Iterate with focused checks, finish integration with `just verify`, and report
the observed RED, GREEN, and commands actually run.
Put behavior tests at crate boundaries in `crates/<crate>/tests/*.rs`; reserve module-local tests for private helpers inaccessible there.
CLI tests invoke the built binary or library and assert output, exit codes, and JSON shape.
Use temporary scratch projects for small inputs; larger copied fixtures belong in `tests/fixtures/<name>/`.
Deliberately invalid CLI fixtures are excluded from Markdown lint and formatting.
Release tool tests in `crates/docbridge-release/tests/` use stub tools and never touch GitHub, the network, or real keys.
The Rust tests are portable, with Unix-specific secret and signal fixtures.
On Windows, the agent fixtures in `cargo test --workspace --locked` require Developer Mode or symbolic link creation privileges; they are not skipped.
`just test` runs `cargo test --workspace --locked`.
`just smoke` runs `xtask smoke` against the host release binary in a throwaway project; CI does the same for five targets.
Host tests do not establish native Windows validation or minimum OS support.

## References

- [Architecture](architecture.md)
- [Release operations](releasing.md)
- [Public contracts](../specs/vnext-contracts.md)
- [User guides](../../crates/docbridge/guides/)
- [Agent instructions](../../AGENTS.md)
