# Contributing to DocBridge

Thank you for improving DocBridge. This guide is the canonical entry point for
setting up the repository, making a change, and preparing a pull request.

## Development environment

The recommended environment is the pinned Nix development shell. It provides
Bun, Node.js, Dart, Rust, `just`, and every formatter and linter used by the shared
quality gate. Install a flake-enabled Nix distribution and optionally
[direnv](https://direnv.net/) before cloning the repository.

Swift is intentionally not supplied by the Nix shell. Install Swift 6.2.1 on
`PATH`; `just verify` checks Swift formatting for the whole repository, even
when a change does not touch the Swift scanner.

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

Install locked Bun and Dart dependencies, build the scanner workers used by the
integration tests, and configure the repository Git hooks:

```sh
just setup
```

From outside the development shell, use:

```sh
nix develop -c just setup
```

Confirm that the required tools and Swift version are visible:

```sh
just doctor
```

The setup command configures `core.hooksPath` as `.githooks`. The pre-commit
hook runs the read-only `just verify` gate and never modifies files, then
reports the staged changes' unstaged linked counterparts without blocking the
commit.

## Start non-trivial work with an accepted issue

Choose an issue form based only on the type of work, regardless of who creates
the issue or implements it:

| Work                                                            | Issue form          |
| --------------------------------------------------------------- | ------------------- |
| Reproducible incorrect behavior or regression                   | Bug report          |
| New capability or user-visible improvement                      | Feature proposal    |
| API, architecture, refactor, build, CI, or dependency design    | Technical proposal  |
| Incorrect, missing, or substantially restructured documentation | Documentation issue |
| Routine upkeep with a concrete outcome                          | Maintenance task    |

Every issue must use the matching form and provide its required information.
Non-trivial work begins only after the issue receives the `status: accepted`
label. Acceptance confirms the agreed problem and scope; it does not guarantee
that a future pull request will merge. A non-trivial pull request without a
linked accepted issue may be closed without detailed review.

An issue is optional only for content-based exceptions: typo, wording,
formatting, broken-link, or similarly small corrections, plus automated
dependency updates. The identity of the issue author
or implementer is never an exception. When uncertain, open the matching issue
form and wait for acceptance before writing code.

Follow the [Writing Guidelines](docs/contributing/writing.md). Each form field
owns distinct information; link to an existing fact instead of paraphrasing it.
Before publishing a body file, run `just prose-report issue <body-file>` and use
its advisory warnings as editing prompts.

## Making a change

1. Start from an up-to-date `main` branch and create a focused branch. Name it
   per [Pull requests](docs/contributing/pull-requests.md)
   (`<feat|fix|chore>/#<issue>-<kebab-desc>`).
2. For non-trivial work, confirm that its matching issue has the
   `status: accepted` label before implementation.
3. Keep code, tests, specifications, and user documentation consistent. Use
   `just related-gate` before committing to find linked counterparts that your
   uncommitted changes did not update.
4. For logic changes, write the failing test first and follow the conventions
   in [Testing](docs/contributing/testing.md).
5. Apply deterministic formatting with `just format`. `just lint-fix` applies
   only Oxlint's safe fixes; review every resulting diff.
6. Run the relevant focused checks while iterating, then run the shared gates
   before opening a pull request.

Do not weaken a formatter, linter, complexity limit, or exclusion to make a
change pass. Fix the underlying issue instead.

## Verification

Run the common read-only gate:

```sh
just verify
```

It runs formatting checks, lint, DocBridge's self-check, documentation structure
and AI-asset checks, TypeScript type checking of the CLI and the editor client,
and the Bun test suite. Also verify the
distributable build:

```sh
just build
```

Run additional checks when the affected area requires them:

| Area                  | Commands                                                  |
| --------------------- | --------------------------------------------------------- |
| Swift scanner         | `just test-swift-scanner`, `just build-swift-scanner`     |
| Dart scanner          | `just test-dart-scanner`, `just build-dart-scanner`       |
| Rust scanner          | `just test-rust-scanner`, `just build-rust-scanner`       |
| TypeScript example    | `just check-example`                                      |
| Swift example         | `just check-swift-example`                                |
| Dart example          | `just check-dart-example`                                 |
| Rust example          | `just check-rust-example`                                 |
| npm distribution      | `just verify-dist`                                        |
| Editor client         | `just typecheck-extension` (also in `just verify`)        |
| VS Code extension     | `just package-vsix`, `just verify-vsix`                   |
| Local VSIX install    | `just package-vsix-local`, `just verify-vsix-local`       |
| Repository self-audit | `just check-audit-baseline` (also covered by `just test`) |

Use `just --list` for the complete task list. If a command must be run outside
an activated shell, prefix it with `nix develop -c`.

`just setup` builds the debug Swift, compiled Dart, and debug Rust workers
required by the Bun integration tests. Rebuild all three after changing worker
code with `just build-test-scanners`.

`just setup` also installs the editor client's own locked dependencies under
`editors/vscode`, which `just typecheck-extension` needs. Install them alone
with `just install-editor-deps`.

## Commits and pull requests

- Write commits in English using the repository's Gitmoji and Conventional
  Commits format. See [Commit messages](docs/contributing/commits.md).
- Write pull request titles as `<gitmoji> <type>: <summary>` describing the
  whole PR. See [Pull requests](docs/contributing/pull-requests.md).
- Keep unrelated changes in separate commits and pull requests.
- Link non-trivial work to its accepted issue with a plain-text `Closes #123` in
  the pull request body (not in backticks or a code fence; GitHub will not
  auto-close otherwise). See
  [Pull requests](docs/contributing/pull-requests.md#linking-issues). If an
  issue is not required, state the content-based exception in the pull request
  template instead.
- Complete the pull request template with the actual commands run and their
  results. Do not check a command that was not run.
- Run `just prose-report pull-request <body-file>` before publishing and review
  its advisory length and repetition warnings.
- For every linked counterpart reported for the pull request's changes, update
  it or explain in the pull request why no corresponding change is needed.
  `just related-gate` covers only uncommitted and untracked files; on a
  committed branch, use the CI related-gate comment, which covers the whole
  pull request.
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
- [Specifications](docs/specs)
- [AI agent integrations](docs/integrations)
- [Project guidance for AI agents](AGENTS.md)
