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

`just setup` sets `core.hooksPath` to `.githooks`; the pre-commit hook runs only
the fast read-only checks, `just format-check` and `just validate`, over the
working tree, not only the staged snapshot, and never modifies files.
`just doctor` confirms that the required tools are visible.

Without Nix, `flake.nix` is the authoritative tool list; install all of its
packages yourself. The repository does not maintain a second set of unpinned
setup instructions.

Coding agents read `AGENTS.md`. This repository keeps its canonical skills,
`docbridge` and `git-workflow`, in `.agents/skills/`.
`.claude/skills` is a symlink to `../.agents/skills`; Windows may check it out as a plain file.

Do not run `init --force --claude` in this repository: the product rejects write
paths through symlinks. After changing the distributable skill embedded in
`crates/docbridge/src/lifecycle.rs`, regenerate the canonical copy with
`cargo run -p docbridge -- init --force --yes`. Keep skill bodies tool-neutral.

## Issues

Issues are optional. Open one to report a problem or to agree on scope before
you invest in a large change.

## Verification

Run the full read-only gate before you report a change complete:

```sh
just verify
```

It covers formatting checks, lint, the workspace tests, and `docbridge validate`
on this repository. `just format` applies deterministic formatting.

Run additional checks when the affected area requires them:

| Area                | Commands                                    |
| ------------------- | ------------------------------------------- |
| Nix package         | `nix build .#docbridge`, `just flake-check` |
| Repository coverage | `just unlinked`                             |

CI runs `just verify`, and lints, tests, builds, and smoke-runs the five release
targets natively; see [Releasing](releasing.md).

If a command must be run outside an activated shell, prefix it with
`nix develop -c`.

## Git and pull requests

Every change lands through a pull request after required CI passes, as
[branch protection](releasing.md#branch-protection) enforces.
Use `<feat|fix|chore>/#<issue>-<kebab-desc>` for branches, omitting `#<issue>-` when no issue exists.
Dependabot branch names are exempt.

Commit subjects use `<gitmoji> <type>(<optional-scope>): <summary>`.
PR titles use `<gitmoji> <type>: <summary>`, without a scope or issue number, and describe the whole PR.
Write imperative English summaries without a trailing period, under 72 characters when practical.
Use `feat` (✨), `fix` (🐛), `docs` (📝), `style` (💄), `refactor` (♻️), `perf` (⚡️), `test` (✅), `build` (📦), `ci` (👷), `chore` (🔧), or `revert` (⏪).
Keep unrelated changes separate; retain generated Dependabot titles.
Breaking changes use `!` after the type/scope and a `BREAKING CHANGE:` footer.

Use the PR template.

A PR with a user-facing change adds its entry under `## [Unreleased]` in
`CHANGELOG.md`; other PRs leave versions and the CHANGELOG unchanged.

A release is one PR that runs `just release X.Y.Z`. It sets the workspace
version in the root `Cargo.toml` and rolls `## [Unreleased]` into
`## [X.Y.Z] - <date>`. During `0.x`, new features and breaking changes bump the
minor version; `major` is reserved for 1.0. Publishing it after the merge is
described in [Releasing](releasing.md#releasing-1).

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
The distributable Skill follows the [Skill and guide split](../specs/vnext-contracts.md#skill-and-guide-split).
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
Host tests do not establish native Windows validation or minimum OS support.
