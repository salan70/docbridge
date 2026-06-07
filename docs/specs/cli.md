# CLI

SpecLink v0.1 provides the `check` command.

```sh
speclink check [--root <path>] [--json] [--audit]
```

`--root <path>` sets the project root. The path must exist and must be a directory. Missing or non-directory roots are CLI invocation errors.

`--json` emits machine-readable JSON:

```json
{
  "diagnostics": [],
  "summary": {
    "errors": 0,
    "warnings": 0
  }
}
```

`summary` counts check diagnostics only. CLI invocation errors are not included.

`--audit` enables audit-only diagnostics. In v0.1, the only audit diagnostic is `undocumented_symbol`.

Human-readable output prints one diagnostic per line:

```text
docs/specs/cli.md:12:1 error doc_anchor_not_found docs/specs/missing.md#check-command - Documentation anchor not found.
src/cli/index.ts:3:1 warning duplicate_link docs/specs/cli.md#check-command - Duplicate link annotation.

Summary: 1 error, 1 warning
```

Diagnostics without a location use the target without line and column:

```text
speclink.config.json error config_file_invalid - Failed to parse config file.
```

CLI option errors, unknown options, missing option values, and invalid roots are written to stderr and exit with code `1`. They do not emit diagnostic JSON, even when `--json` is present.

<!-- @code src/cli/index.ts#run -->
## Check Command

The check command parses CLI options, runs the checker against the resolved
project root, prints diagnostics, and returns the process exit code.
