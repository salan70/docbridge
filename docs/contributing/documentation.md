# Documentation Guidelines

Each documentation class has one audience and one job. Put a fact in its
authoritative location, then link to it from other pages with only enough
context for the reader to choose the next step.

## Information architecture

| Location                             | Audience and ownership                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `README.md`                          | First-time English reader: value, requirements, installation, one successful check, and next links        |
| `docs/README.md`                     | Repository-wide map of user, integration, specification, contributor, decision, and plan documentation    |
| `docs/user/`                         | Task-oriented English guides shipped with the npm package                                                 |
| `docs/ja/README.md`, `docs/ja/user/` | Repository-hosted Japanese entry point and task-guide parity                                              |
| `docs/specs/`                        | Normative and exhaustive behavior for commands, configuration, diagnostics, scanning, resolution, and LSP |
| `docs/integrations/`                 | Tool-specific setup and copyable integration recipes                                                      |
| `editors/vscode/README.md`           | Installation and operation of the VS Code-compatible extension                                            |
| `docs/contributing/`                 | Repository development, testing, documentation, commit, and pull-request policy                           |
| `docs/decisions/`                    | Durable architectural decisions and their rationale                                                       |
| `docs/plans/`, `docs/plans/done/`    | Active implementation tracking and historical completed plans                                             |

Task guides explain how to achieve an outcome and link to specifications for
exact contracts. Integration pages build on the general automation guide and
own only client-specific details. Decisions and completed plans explain why or
how work landed; they are not current user instructions.

## Canonical user guides

The English and Japanese sets use the same six basenames:

- `getting-started`
- `configuration`
- `linking`
- `commands`
- `automation`
- `troubleshooting`

English files require YAML frontmatter with a one-line `description`, are
included by `docbridge.config.json`, and may carry reciprocal `@code`
annotations. They are packaged and listed by `docbridge docs list`.

Japanese files are repository-hosted translations. They have no frontmatter,
stay outside `docbridge.config.json`, and must not carry active `@code`
annotations. Runnable examples may show annotations inside fenced code blocks.
Translate the meaning naturally: preserve tasks, constraints, examples, and
next steps without forcing sentence-by-sentence equivalence.

When one language changes materially, update the counterpart in the same pull
request. `just check-docs` verifies file-set parity and navigation; reviewers
verify semantic parity.

## Writing rules

Follow the repository [Writing Guidelines](writing.md). For documentation, also:

- separate task guidance from exhaustive contracts and link to the specification;
- keep roadmap, release history, and maintainer-only process out of user guides;
- prefer minimal commands and examples that a reader can run or adapt; and
- end each task guide with purposeful next steps rather than a general link dump.

## Structural checks

Run:

```sh
just check-docs
```

The check enforces the exact bilingual guide sets, navigation coverage from the
English and Japanese entry points, the Japanese annotation boundary, and
resolvable local file and heading links across active user-facing surfaces. It
uses GitHub-style heading fragments because these links are consumed in the
repository UI. `just verify` includes this check.
