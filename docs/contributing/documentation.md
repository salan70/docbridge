# Documentation Guidelines

Each documentation class has one audience and one job. Put a fact in its
authoritative location, then link to it from other pages with only enough
context for the reader to choose the next step.

## Information architecture

| Location                          | Audience and ownership                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `README.md`                       | First-time English reader: value, installation, one successful link, and next links                 |
| `docs/README.md`                  | Repository-wide map of guides, specifications, contributor, decision, and plan documentation        |
| `crates/docbridge/guides/`        | Task-oriented English user guides embedded in the CLI and printed by `docbridge docs`               |
| `docs/ja/`                        | Repository-hosted Japanese entry point and contributor translations                                 |
| `docs/specs/`                     | Normative and exhaustive behavior for commands, output, diagnostics, and the vNext public contracts |
| `crates/docbridge-update/`        | The update crate's README: release format, installation receipt, replacement, and recovery          |
| `docs/contributing/`              | Repository development, testing, documentation, commit, pull-request, and release policy            |
| `docs/decisions/`                 | Durable architectural decisions and their rationale                                                 |
| `docs/plans/`, `docs/plans/done/` | Active implementation tracking and historical completed plans                                       |
| `docs/reports/`                   | Dated evidence reports such as dogfooding reviews; historical observations, not current guidance    |

Task guides explain how to achieve an outcome. The embedded guides are printed
by `docbridge docs show` without a repository checkout, so they link only to
each other, by file name, and never to repository paths. Decisions, completed
plans, and reports explain why or how work landed; they are not current user
instructions. Records written before the cutover (#215) describe the npm
package and its TypeScript CLI. A link from them to a file removed at the
cutover points to that file at the last commit before the cutover on GitHub.

## User guides

The embedded guides are `getting-started`, `configuration`, `linking`,
`commands`, `troubleshooting`, `automation`, `migration`, and `deinit`, listed
in `crates/docbridge/src/docs.rs`. They carry no `@code` annotations, because
`docbridge docs` prints them verbatim, and they stay outside `include.docs`.
The distributable Skill stays thin and points to `docbridge docs`; the guides
own the detail.

Japanese pages are repository-hosted translations and are not embedded. They
stay outside `docbridge.config.json` and must not carry active `@code`
annotations. Runnable examples may show annotations inside fenced code blocks.
Translate the meaning naturally: preserve tasks, constraints, examples, and
next steps without forcing sentence-by-sentence equivalence.

## Writing rules

Follow the repository [Writing Guidelines](writing.md). For documentation, also:

- separate task guidance from exhaustive contracts and link to the specification;
- keep roadmap, release history, and maintainer-only process out of user guides;
- prefer minimal commands and examples that a reader can run or adapt; and
- end each task guide with purposeful next steps rather than a general link dump.

## Structural checks

`just lint-markdown` runs rumdl over every Markdown file. Besides style, it
fails on a relative link to a missing file and on a fragment that matches no
heading. `just validate` checks the `@code` annotations. `just verify` includes
both.
