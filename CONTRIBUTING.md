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

Coding agents read `AGENTS.md`, which `CLAUDE.md` imports. Each skill's source
is `.agents/skills/<name>/`, and `.claude/skills/<name>` is a symlink to it.
The exception is the distributable `docbridge` skill: `docbridge init --claude`
installs it as a managed copy in both trees, with an ownership record. Its text
is embedded in `crates/docbridge/src/lifecycle.rs`; after changing it, reinstall
both copies with `cargo run -p docbridge -- init --force --claude --yes`. Keep
skill bodies tool-neutral. `just lint-ai-assets` enforces this layout.

## Issues

Issues are optional. Open one to report a problem, to propose a change, or to
agree on scope before you invest in a large change. Choose the form by the type
of work:

| Work                                                            | Issue form          |
| --------------------------------------------------------------- | ------------------- |
| Reproducible incorrect behavior or regression                   | Bug report          |
| New capability or user-visible improvement                      | Feature proposal    |
| API, architecture, refactor, build, CI, or dependency design    | Technical proposal  |
| Incorrect, missing, or substantially restructured documentation | Documentation issue |
| Routine upkeep with a concrete outcome                          | Maintenance task    |

Provide the form's required information and follow the
[Writing Guidelines](docs/contributing/writing.md). Each form field owns
distinct information; link to an existing fact instead of paraphrasing it.

## Making a change

1. Start from an up-to-date `main` branch and create a focused branch. Name it
   per [Pull requests](docs/contributing/pull-requests.md)
   (`<feat|fix|chore>/#<issue>-<kebab-desc>`, without `#<issue>` when no issue
   exists).
2. Keep code, tests, specifications, and user documentation consistent. For
   each file or section you change, `just links <path> --include-content` shows
   its linked counterparts; update them or confirm that they still agree.
3. For logic changes, write the failing test first and follow the conventions
   in [Testing](docs/contributing/testing.md).
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
[Releasing](docs/contributing/releasing.md#dry-run).

Use `just --list` for the complete task list. If a command must be run outside
an activated shell, prefix it with `nix develop -c`.

## Commits and pull requests

- Write commits in English using the repository's Gitmoji and Conventional
  Commits format. See [Commit messages](docs/contributing/commits.md).
- Write pull request titles as `<gitmoji> <type>: <summary>` describing the
  whole PR. See [Pull requests](docs/contributing/pull-requests.md).
- Keep unrelated changes in separate commits and pull requests.
- Add exactly one `release:` label to every pull request; the required
  `release-label` check fails without it. See
  [Pull requests](docs/contributing/pull-requests.md#release-label) for the
  labels and the version bump a releasing label requires.
- Link the issue a pull request resolves as described in
  [Pull requests](docs/contributing/pull-requests.md#linking-issues). Without
  an issue, the pull request states the problem it solves.
- Complete the pull request template with the actual commands run and their
  results. Do not check a command that was not run.
- For every linked counterpart of the pull request's changes, update it or
  explain in the pull request why no corresponding change is needed.
- All changes land through a pull request. Maintainers merge with a merge
  commit after the required CI checks pass.

## Project references

- [Module architecture](docs/contributing/architecture.md)
- [Testing](docs/contributing/testing.md)
- [Writing](docs/contributing/writing.md)
- [Documentation](docs/contributing/documentation.md)
- [Self-audit](docs/contributing/self-audit.md)
- [Commit messages](docs/contributing/commits.md)
- [Pull requests](docs/contributing/pull-requests.md)
- [Releasing](docs/contributing/releasing.md)
- [Specifications](docs/specs)
- [User guides](crates/docbridge/guides)
- [Project guidance for AI agents](AGENTS.md)
