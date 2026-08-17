---
description: Diagnose configuration, scanner, parsing, and broken-link errors.
---

# Troubleshooting

Start with the first error line, then follow any recovery guidance printed on
stderr. Use `docbridge <command> --help` for invocation errors and
`docbridge check --json` when a tool needs stable diagnostic fields.

## Configuration errors

`config_file_invalid` means `docbridge.config.json` is missing, malformed, or
does not match the schema. Run `docbridge init --dry-run` when the file is
missing. When it exists, repair or remove it before running `check` again.

`config_unknown_key` and `config_invalid_value` mean a present file has a key
or value the schema rejects. Confirm that include patterns match real files
relative to the selected `--root`, language keys are supported, and excludes
do not remove an intended link target.

## Scanner errors

Swift, Dart, and Rust use packaged scanner workers. A
`code_scanner_unavailable` diagnostic usually means the installed package
lacks a binary for the current platform or the binary cannot execute.
Reinstall the package first. If the platform is not supported, run DocBridge
in a supported environment or build the scanner from the repository.

`code_scanner_failed` diagnostics contain the worker failure rather than
converting it into a broken link. Check that the source parses with the
project's own toolchain, then reproduce with the smallest configured file
set.

## Link-authoring errors

These codes appear while writing `@doc` / `@code` pairs:

| Diagnostic                                           | Meaning                                  | Usual fix                                             |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `doc_file_not_found` / `code_file_not_found`         | target file not in the managed set       | fix the path, or extend `docbridge.config.json` globs |
| `doc_anchor_not_found`                               | file found, anchor wrong                 | regenerate the anchor from the exact heading text     |
| `doc_backlink_not_found` / `code_backlink_not_found` | one direction missing                    | add the missing `@code` or `@doc` side                |
| `unsupported_declaration`                            | `@doc` on an unsupported declaration     | move the tag to a supported declaration               |
| `dangling_code_annotation`                           | text between `@code` and the heading     | move the comment directly above the heading           |
| `invalid_link_target`                                | malformed `file#fragment`                | rewrite the target; see `docs show annotations`       |
| `duplicate_doc_anchor`                               | two headings share an anchor in one file | rename one heading so anchors stay unique             |
| `duplicate_code_symbol`                              | two annotated declarations share an ID   | keep one `@doc` per canonical ID in that file         |
| `duplicate_link`                                     | the same source repeats the same target  | remove the extra annotation                           |

Use `docbridge graph --json` to inspect resolved and one-way edges. Use
`docbridge context <file>` to confirm which counterpart content DocBridge can
currently resolve.

<!-- @code src/cli/errors.ts#formatCliError -->

## CLI invocation errors

Unknown commands, unknown options, missing values, invalid roots, and missing
required inputs exit `1`, write to stderr, and leave stdout empty. These are not
included in diagnostic JSON because the project scan did not run.
