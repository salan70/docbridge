# Contributing to DocBridge

Thank you for improving DocBridge. This guide is the canonical entry point for
setting up the repository, making a change, and preparing a pull request.

## Development environment

The recommended environment is the pinned Nix development shell. It provides
Bun, Node.js, Dart, `just`, and every formatter and linter used by the shared
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
hook runs the read-only `just verify` gate and never modifies files.

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
dependency updates and release pull requests. The identity of the issue author
or implementer is never an exception. When uncertain, open the matching issue
form and wait for acceptance before writing code.

## Making a change

1. Start from an up-to-date `main` branch and create a focused branch. Use the
   existing `feat/`, `fix/`, or `chore/` prefix that matches the change.
2. For non-trivial work, confirm that its matching issue has the
   `status: accepted` label before implementation.
3. Keep code, tests, specifications, and user documentation consistent. Use
   `just related-gate` to find linked counterparts that a change did not update.
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

It runs formatting checks, lint, DocBridge's self-check, TypeScript type
checking, and the Bun test suite. Also verify the distributable build:

```sh
just build
```

Run additional checks when the affected area requires them:

| Area               | Commands                                              |
| ------------------ | ----------------------------------------------------- |
| Swift scanner      | `just test-swift-scanner`, `just build-swift-scanner` |
| Dart scanner       | `just test-dart-scanner`, `just build-dart-scanner`   |
| TypeScript example | `just check-example`                                  |
| Swift example      | `just check-swift-example`                            |
| Dart example       | `just check-dart-example`                             |
| npm distribution   | `just verify-dist`                                    |
| VS Code extension  | `just package-vsix`, `just verify-vsix`               |

Use `just --list` for the complete task list. If a command must be run outside
an activated shell, prefix it with `nix develop -c`.

`just setup` builds the debug Swift worker and compiled Dart worker required by
the Bun integration tests. Rebuild both after changing worker code with
`just build-test-scanners`.

## Commits and pull requests

- Write commits in English using the repository's Gitmoji and Conventional
  Commits format. See [Commit messages](docs/contributing/commits.md).
- Keep unrelated changes in separate commits and pull requests.
- Link non-trivial work to its accepted issue with `Closes #123`. If an issue is
  not required, state the content-based exception in the pull request template.
- Complete the pull request template with the actual commands run and their
  results. Do not check a command that was not run.
- For every `just related-gate` finding, update the linked counterpart or
  explain in the pull request why no corresponding change is needed.
- All changes land through a pull request. Maintainers merge with a merge
  commit after the required CI checks pass.

## Project references

- [Testing](docs/contributing/testing.md)
- [Commit messages](docs/contributing/commits.md)
- [Specifications](docs/specs)
- [AI agent integrations](docs/integrations)
- [Project guidance for AI agents](AGENTS.md)
