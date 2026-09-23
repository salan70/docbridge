---
description: Diagnose configuration, scanner, parsing, and broken-link errors.
---

# Troubleshooting

Start with the first error line, then follow any recovery guidance printed on
stderr. Use `docbridge <command> --help` for invocation errors and
`docbridge check --json` when a tool needs stable diagnostic fields.

## Configuration errors

`config_file_invalid` means `docbridge.config.json` is missing, cannot be read
(for example, the path is a directory or lacks read permission), or is not
valid JSON. The message says the file was not found in both of the first two
cases. Run `docbridge init --dry-run` when the file is missing. When the path
exists, make it a readable file with valid JSON, or remove it, before running
`check` again.

`config_unknown_key` means a parsed file has a key DocBridge does not know,
such as a misspelled property. `config_invalid_value` means a known key has a
value DocBridge rejects, such as an unsupported language, an empty pattern
list, or a pattern with the wrong file suffix. Compare the file with
[Configuration](configuration.md), and confirm that include patterns match
real files relative to the selected `--root`.

The same three codes apply to an optional `docbridge.links.json` link manifest.
When that file cannot be read or parsed, the CLI prints guidance to repair or
delete it. See [Linking](linking.md) for its format.

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

`code_parse_error` means a TypeScript, Swift, Dart, or Rust source file has a
syntax error. DocBridge extracts no links or symbols from that file, so fix the
syntax before judging link diagnostics that involve it. Unlike
`code_scanner_failed`, the worker ran correctly; the source itself did not
parse.

`file_read_error` means a file matched by the configuration could not be read,
for example because of permissions or a broken symbolic link. The message
contains the operating-system reason.

## Link-authoring errors

These codes appear while writing `@doc` / `@code` pairs:

| Diagnostic                                           | Meaning                                   | Usual fix                                                 |
| ---------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `doc_file_not_found` / `code_file_not_found`         | target file not in the managed set        | fix the path, or extend `docbridge.config.json` globs     |
| `doc_anchor_not_found`                               | file found, anchor wrong                  | regenerate the anchor from the exact heading text         |
| `code_symbol_not_found`                              | manifest names a symbol that is not there | rename the entry, or follow the `Did you mean` suggestion |
| `doc_backlink_not_found` / `code_backlink_not_found` | one direction missing                     | add the missing `@code` or `@doc` side                    |
| `unsupported_declaration`                            | `@doc` on an unsupported declaration      | move the tag to a supported declaration                   |
| `dangling_code_annotation`                           | text between `@code` and the heading      | move the comment directly above the heading               |
| `invalid_link_target`                                | malformed `file#fragment`                 | rewrite the target; see `docs show linking`               |
| `duplicate_doc_anchor`                               | two headings share an anchor in one file  | rename one heading so anchors stay unique                 |
| `duplicate_code_symbol`                              | two annotated declarations share an ID    | keep one `@doc` per canonical ID in that file             |
| `duplicate_link`                                     | the same source repeats the same target   | remove the extra annotation                               |

`undocumented_symbol` and `unlinked_doc_section` appear only with
`docbridge check --audit`. They are warnings that list unlinked endpoints, not
authoring errors.

Use `docbridge graph --json` to inspect resolved and one-way edges. Use
`docbridge context <file>` to confirm which counterpart content DocBridge can
currently resolve.

<!-- @code src/cli/errors.ts#formatCliError -->

## CLI invocation errors

Unknown commands, unknown options, missing values, invalid roots, and missing
required inputs exit `1`, write to stderr, and leave stdout empty. These are not
included in diagnostic JSON because the project scan did not run.

`docbridge upgrade --force` is one of these when it would replace or remove a
managed skill directory without a terminal to confirm on. Re-run it with
`--yes`, or inspect the plan first with `docbridge upgrade --check` or
`docbridge upgrade --force --dry-run`.

When `docbridge docs show <name>` rejects a name, use a name printed by
`docbridge docs list`. Former guide names are no longer accepted.
