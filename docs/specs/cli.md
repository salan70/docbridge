# CLI

SpecLink provides the `check` and `related` commands.

```sh
speclink [--version] [--help]
speclink check [--root <path>] [--json] [--audit]
speclink related [--root <path>] [--json] [--stdin] [--gate] [files...]
```

`--version` and `--help` are global flags handled before command dispatch. The
remaining options are specific to each command.

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

`--version` (alias `-v`) prints the SpecLink version on stdout and exits with code `0`. `--help` (alias `-h`) prints usage on stdout and exits with code `0`.

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

<!-- @code src/core/related.ts#related -->
## Related Command

The related command is an informational command: given a set of changed files,
it lists the linked counterparts of every linked endpoint in those files. By
default it performs no validation and renders no judgment; deciding whether a
counterpart also needs a change is left to the consumer (a human, an agent, or
a CI script). The `--gate` flag opts into the one judgment SpecLink can make
mechanically (see [Related Gate Mode](#related-gate-mode)). It is designed to
sit behind `git`:

```sh
# pre-commit
git diff --name-only --cached | speclink related --stdin

# CI (PR diff)
git diff --name-only origin/main...HEAD | speclink related --stdin

# manual
speclink related src/core/graph.ts
```

Changed files are passed as positional arguments, as newline-separated paths
on stdin with `--stdin`, or both combined. Invoking `related` with neither
positional files nor `--stdin` is a CLI invocation error. Empty stdin input is
valid and reports zero changed files.

Input paths are interpreted relative to the project root (the same form
emitted by `git diff --name-only` when run at the repository root). Absolute
paths are relativized against the root, leading `./` segments are stripped,
empty entries are dropped, and duplicates are deduplicated.

Counterparts follow the link graph semantics used by LSP navigation:
resolvable one-way links contribute counterparts even when the backlink is
missing. Changed files that are not in the managed set, do not exist, or have
no linked endpoints are silently excluded from the report; they are only
reflected in the summary count. As a consequence, links that a deleted file
used to carry cannot be reported (the dangling annotations they leave behind
are `speclink check`'s concern).

Human-readable output prints one block per changed file with links. Each line
shows the endpoint fragment in the changed file, the counterpart endpoint, and
whether the counterpart's file is itself in the change set. The summary line
is always printed:

```text
src/auth/login.ts
  login -> docs/auth.md#login-spec (not in change set)

2 changed files, 1 with links
```

`--json` emits the same data as machine-readable JSON:

```json
{
  "files": [
    {
      "filePath": "src/auth/login.ts",
      "endpoints": [
        {
          "endpoint": "src/auth/login.ts#login",
          "counterparts": [
            {
              "endpoint": "docs/auth.md#login-spec",
              "filePath": "docs/auth.md",
              "inChangeSet": false
            }
          ]
        }
      ]
    }
  ],
  "summary": {
    "changedFiles": 2,
    "filesWithLinks": 1
  }
}
```

Output ordering is deterministic: files sort by path, endpoints within a file
sort by source position, and counterparts sort by file path then position.

Without `--gate`, `related` exits with code `0` on success regardless of what
it finds. Only CLI invocation errors and configuration errors exit with code
`1`.

<!-- @code src/core/related.ts#collectGateViolations -->
## Related Gate Mode

`related --gate` turns the report into a verdict: it collects every
counterpart whose file is not itself in the change set (a *violation*), prints
only those, and exits with code `1` when at least one exists. The check is
symmetric, mirroring the bidirectional link graph: a changed code file with an
unchanged linked doc is a violation, and a changed doc with an unchanged
linked code file is one too.

A violation does not necessarily mean the counterpart must change; it means
nobody has decided yet. The intended consumer is a guardrail (an agent Stop
hook or a CI step) that asks the author to either update the counterpart or
explicitly justify leaving it unchanged. Deciding what counts as the change
set (staged files, working tree, PR diff) remains the caller's concern, the
same as in the default mode.

Human-readable output prints one line per violation, then the summary line,
which is always printed:

```text
src/auth/login.ts#login -> docs/auth.md#login-spec (counterpart not in change set)

1 changed file, 1 counterpart not in change set
```

`--gate --json` emits the violations as machine-readable JSON:

```json
{
  "violations": [
    {
      "changedEndpoint": "src/auth/login.ts#login",
      "changedFilePath": "src/auth/login.ts",
      "counterpartEndpoint": "docs/auth.md#login-spec",
      "counterpartFilePath": "docs/auth.md"
    }
  ],
  "summary": {
    "changedFiles": 1,
    "violations": 1
  }
}
```

Violations follow the default mode's ordering (files by path, endpoints by
position, counterparts by file path then position). Gate mode exits `0` when
there are no violations — including when the change set is empty or has no
links — and `1` when at least one violation exists. CLI invocation errors and
configuration errors exit with code `1` as usual.
