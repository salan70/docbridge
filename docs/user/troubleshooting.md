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

Confirm that include patterns match real files relative to the selected
`--root`, language keys are supported, and excludes do not remove an intended
link target.

## Scanner errors

Swift, Dart, and Rust use packaged scanner workers. A `scanner_unavailable` diagnostic
usually means the installed package lacks a binary for the current platform or
the binary cannot execute. Reinstall the package first. If the platform is not
supported, run DocBridge in a supported environment or build the scanner from
the repository.

`scanner_failed` diagnostics contain the worker failure rather than converting
it into a broken link. Check that the source parses with the project's own
toolchain, then reproduce with the smallest configured file set.

## Parsing and target errors

- A missing documentation file or anchor means the `@doc` path or normalized
  heading anchor does not resolve.
- A missing code file or symbol means the `@code` path or canonical symbol ID
  does not resolve.
- A missing backlink means one direction resolves but the counterpart lacks
  the reciprocal annotation.
- A malformed annotation means the comment syntax or target shape is invalid.

Use `docbridge graph --json` to inspect resolved and one-way edges. Use
`docbridge context <file>` to confirm which counterpart content DocBridge can
currently resolve.

<!-- @code src/cli/errors.ts#formatCliError -->

## CLI invocation errors

Unknown commands, unknown options, missing values, invalid roots, and missing
required inputs exit `1`, write to stderr, and leave stdout empty. These are not
included in diagnostic JSON because the project scan did not run.
