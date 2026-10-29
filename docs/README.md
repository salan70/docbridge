# DocBridge Documentation

Choose the shortest path for the task. User guides explain how to achieve an
outcome; specifications define exhaustive behavior.

[日本語の入口](ja/README.md)

## Use DocBridge

The English user guides ship inside the CLI. Read them offline with
`docbridge docs list` and `docbridge docs show <name>`. Their sources are
under [`crates/docbridge/guides/`](../crates/docbridge/guides/):

- [Getting started](../crates/docbridge/guides/getting-started.md)
- [Configuration](../crates/docbridge/guides/configuration.md)
- [Linking](../crates/docbridge/guides/linking.md)
- [Commands](../crates/docbridge/guides/commands.md)
- [Troubleshooting](../crates/docbridge/guides/troubleshooting.md)
- [Automation](../crates/docbridge/guides/automation.md) — agents, Git hooks,
  and CI
- [Migration](../crates/docbridge/guides/migration.md) — from the npm package
  (`0.16.0` and earlier)
- [Removal](../crates/docbridge/guides/deinit.md)

Release history is in the [Changelog](../CHANGELOG.md).

## Understand the contracts

- [vNext public contracts](specs/vnext-contracts.md) — selectors, paths,
  annotations, configuration, exit codes, project assets, and signed updates
- [CLI](specs/cli.md) — commands and the output model
- [Diagnostics](specs/diagnostics.md) — diagnostic codes
- [Update crate](../crates/docbridge-update/README.md) — the signed release
  format, installation receipt, and replacement and recovery

## Contribute to DocBridge

- [Contributor guide](../CONTRIBUTING.md)
- [Module architecture](contributing/architecture.md)
- [Writing guidelines](contributing/writing.md)
- [Documentation guidelines](contributing/documentation.md)
- [Testing](contributing/testing.md)
- [Commit messages](contributing/commits.md)
- [Pull requests](contributing/pull-requests.md)
- [Releasing](contributing/releasing.md)
- [Self-audit](contributing/self-audit.md)

## Historical records

Architectural choices are recorded in [Decisions](decisions/README.md).
Completed delivery records are archived under
[Completed plans](plans/done/README.md), and dated evidence reports such as the
[Dogfooding review, September 2026](reports/2026-09-dogfooding-review.md) live
under `reports/`. They describe the npm package and its TypeScript CLI where
they predate the cutover (#215). They are historical context, not current user
instructions.
