# Contributing to DocBridge

Setup, pull request conventions, and documentation policy for DocBridge contributors.

## Development environment

Use the pinned Nix flake shell (`direnv allow` or `nix develop`). It provides the
toolchain pinned by `rust-toolchain.toml`, `just`, and every formatter and linter
in the shared quality gate. Then run:

```sh
just setup
just doctor
```

`just setup` sets `core.hooksPath` to `.githooks`; the pre-commit hook runs the
read-only `just verify` gate and never modifies files. `just doctor` confirms
that the required tools are visible.

Without Nix, `flake.nix` is the authoritative tool list; install all of its
packages yourself. The repository does not maintain a second set of unpinned
setup instructions.

Coding agents read `AGENTS.md`. This repository keeps exactly two canonical
skills, `docbridge` and `git-workflow`, in `.agents/skills/`.
The whole `.claude/skills` directory is a symlink to `../.agents/skills`, and
`just lint-ai-assets` enforces this layout. On Windows, enable Git symlink
checkout with the required OS permissions; there is no copy fallback.

Do not run `init --force --claude` in this repository: the product rejects write
paths through symlinks. After changing the distributable skill embedded in
`crates/docbridge/src/lifecycle.rs`, regenerate the canonical copy with
`cargo run -p docbridge -- init --force --yes`. Keep skill bodies tool-neutral.

## Issues

Issues are optional. Open one to report a problem or to agree on scope before
you invest in a large change.

## Verification

Run the common read-only gate:

```sh
just verify
```

It covers formatting checks, lint, the workspace tests, and `docbridge validate`
on this repository. `just format` applies deterministic formatting. Also
smoke-test the release binary for this machine:

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
targets; see [Releasing](releasing.md).

If a command must be run outside an activated shell, prefix it with
`nix develop -c`.

## Git and pull requests

Every change lands through a pull request and a merge commit after required CI passes.
Agents require explicit human approval to merge; merging publishes nothing.
Use `<feat|fix|chore>/#<issue>-<kebab-desc>` for branches, omitting `#<issue>-` when no issue exists.
Dependabot branch names are exempt.

Commit subjects use `<gitmoji> <type>(<optional-scope>): <summary>`.
PR titles use `<gitmoji> <type>: <summary>`, without a scope or issue number, and describe the whole PR.
Write imperative English summaries without a trailing period, under 72 characters when practical.
Use `feat` (✨), `fix` (🐛), `docs` (📝), `style` (💄), `refactor` (♻️), `perf` (⚡️), `test` (✅), `build` (📦), `ci` (👷), `chore` (🔧), or `revert` (⏪).
Keep unrelated changes separate; retain generated Dependabot titles.
Breaking changes use `!` after the type/scope and a `BREAKING CHANGE:` footer.

Use the PR template.

Every PR requires exactly one release label. During `0.x`, new features and
breaking changes bump the minor version; `major` is reserved for 1.0.

| Label            | Use when                                        | Bump                                                    |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `release: none`  | No user-facing change (docs, CI, refactor, ...) | Versions and CHANGELOG `## [Unreleased]` stay unchanged |
| `release: patch` | User-facing fix                                 | `just release-bump patch`                               |
| `release: minor` | New feature, or a breaking change during `0.x`  | `just release-bump minor`                               |
| `release: major` | Breaking change after 1.0                       | `just release-bump major`                               |

For a releasing PR, add the entries under `## [Unreleased]`, then run
`just release-bump <kind>` in the same PR. The required `release-label` check
enforces this; `just check-release-label "release: <kind>"` runs it locally.
If `main` gains another release before the PR merges, update the branch,
restore `main`'s versions and CHANGELOG sections, and rerun the bump.
Merging publishes nothing; a maintainer dispatches Release vNext, see
[release operations](releasing.md).

## Documentation

Write repository artifacts in English.
Keep one authoritative explanation per fact and link to it instead of copying it.
Issues own problems and acceptance criteria; PRs own delivered results and verification; CHANGELOG owns release history.

| Location                            | Owns                                               |
| ----------------------------------- | -------------------------------------------------- |
| `AGENTS.md`                         | Agent rules loaded every session                   |
| `.agents/skills/git-workflow/`      | Agent git procedure: branch, push, merge, clean up |
| `README.md`                         | Installation, readiness, and routes to guides      |
| `crates/docbridge/guides/`          | Canonical offline user tasks                       |
| `docs/specs/vnext-contracts.md`     | Single developer behavior contract                 |
| `docs/contributing/README.md`       | Contributor workflow and documentation policy      |
| `docs/contributing/architecture.md` | Module responsibilities and dependencies           |
| `docs/contributing/releasing.md`    | Detailed release operations and pending work       |

Embedded guides link only to each other by filename because `docbridge docs` prints them without a checkout.
They have no active `@code` annotations and stay outside `include.docs`.
Keep the distributable Skill thin; guides own user detail.
Link normative sections and design references to the Rust file implementing them, using `@code` before a heading.
Tests, re-export modules, process prose, and overviews can remain unlinked; zero unlinked items is not a goal.
Run `just links <path> --include-content` for changed linked sections and confirm agreement or update counterparts.
Historical CHANGELOG links remain unchanged even when their targets have retired.

### Test conventions

Write a regression test before a bug fix or logic change and observe its failure
for the expected reason before implementing the smallest passing change.
Refactor only while green. Behavior-preserving refactors need no new failing
test when coverage exists; otherwise add a characterization test first.
Never delete, skip, or weaken tests to pass; explain corrections to wrong tests.
Avoid content-existence tests that merely freeze wording.
Put behavior tests at crate boundaries in `crates/<crate>/tests/*.rs`; reserve module-local tests for private helpers inaccessible there.
Use temporary scratch projects for small inputs; larger copied fixtures belong in `tests/fixtures/<name>/`.
Deliberately invalid CLI fixtures are excluded from Markdown lint and formatting.
On Windows, the agent fixtures in `cargo test --workspace --locked` require Developer Mode or symbolic link creation privileges; they are not skipped.
Host tests do not establish native Windows validation or minimum OS support.
