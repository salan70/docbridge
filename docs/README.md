# DocBridge Documentation

Choose the shortest path for the task. User guides explain how to achieve an
outcome; specifications define exhaustive behavior; integration recipes adapt
the general workflow to a particular tool.

[日本語の入口](ja/README.md)

## Use DocBridge

These English guides are also installed with the npm package and available
through `docbridge docs show <name>`:

- [Getting started](user/getting-started.md) — install, configure, and validate
  the first reciprocal link
- [Configuration](user/configuration.md) — choose roots, patterns, languages,
  and visibility
- [Linking](user/linking.md) — select sections, author annotation pairs, and
  review their meaning
- [Commands](user/commands.md) — choose between check, related, context, graph,
  and docs
- [Automation](user/automation.md) — connect agents, Git hooks, and CI
- [Troubleshooting](user/troubleshooting.md) — recover from configuration,
  scanner, parsing, and link diagnostics

## Automate and integrate

- [Claude Code](integrations/claude-code.md)
- [Codex](integrations/codex.md)
- [Continuous integration](integrations/ci.md)
- [VS Code-compatible extension](../editors/vscode/README.md)

These pages contain client-specific setup and runnable recipes. The general
editing and gate policy stays in [Automation](user/automation.md).

## Understand the contracts

Normative command, configuration, diagnostic, scanning, link-resolution, and
language-server behavior lives under [Specifications](specs/cli.md). Start
with the specification for the interface whose exact contract you need:

- [CLI](specs/cli.md)
- [Configuration](specs/configuration.md)
- [Annotations](specs/annotations.md)
- [Scanning](specs/scanning.md)
- [Link resolution](specs/link-resolution.md)
- [Diagnostics](specs/diagnostics.md)
- [Language server](specs/lsp.md)

## Contribute to DocBridge

- [Contributor guide](../CONTRIBUTING.md)
- [Writing guidelines](contributing/writing.md)
- [Documentation guidelines](contributing/documentation.md)
- [Testing](contributing/testing.md)
- [Commit messages](contributing/commits.md)
- [Pull requests](contributing/pull-requests.md)
- [Self-audit baseline](contributing/self-audit.md)

Architectural choices are recorded in [Decisions](decisions/v0.1.md).
Completed delivery records are archived under
[Completed plans](plans/done/v0.1-implementation-plan.md). They are historical
context, not current user instructions.
