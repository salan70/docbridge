# CLI

DocBridge provides the `check`, `related`, `context`, `graph`, `init`, and
`init-with-agent` commands.

```sh
docbridge [--version] [--help]
docbridge check [--root <path>] [--json] [--audit]
docbridge related [--root <path>] [--json] [--stdin] [--gate] [files...]
docbridge context [--root <path>] [--json] [--stdin] [files...]
docbridge graph [--root <path>] [--json] [--include-content] [--stdin] [files...]
docbridge init [--root <path>] [--yes] [--dry-run] [--force] [--agent-target <target>]
docbridge init-with-agent [--root <path>] [--yes] [--dry-run] [--force] [--agent-target <target>]
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

`--version` (alias `-v`) prints the DocBridge version on stdout and exits with code `0`. `--help` (alias `-h`) prints usage on stdout and exits with code `0`.

Human-readable output prints one diagnostic per line:

```text
docs/specs/cli.md:12:1 error doc_anchor_not_found docs/specs/missing.md#check-command - Documentation anchor not found.
src/cli/index.ts:3:1 warning duplicate_link docs/specs/cli.md#check-command - Duplicate link annotation.

Summary: 1 error, 1 warning
```

Diagnostics without a location use the target without line and column:

```text
docbridge.config.json error config_file_invalid - Failed to parse config file.
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
a CI script). The `--gate` flag opts into the one judgment DocBridge can make
mechanically (see [Related Gate Mode](#related-gate-mode)). It is designed to
sit behind `git`:

```sh
# pre-commit
git diff --name-only --cached | docbridge related --stdin

# CI (PR diff)
git diff --name-only origin/main...HEAD | docbridge related --stdin

# manual
docbridge related src/core/graph.ts
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
are `docbridge check`'s concern).

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

<!-- @code src/core/graph-output.ts#graph -->
## Graph Command

The graph command prints the resolved DocBridge graph. It includes complete
bidirectional links and resolvable one-way links: an annotation contributes an
edge when its target file and anchor/symbol exist, even if the backlink is
missing. Broken targets remain diagnostics and do not become graph edges.

```sh
# whole project
docbridge graph

# a file plus directly linked counterparts
docbridge graph src/auth/login.ts

# machine-readable graph for tools and agents
docbridge graph --json --include-content
```

Input files are optional. With no files and no `--stdin`, `graph` emits the
whole managed project graph. With positional files, `--stdin`, or both, the
output is scoped to endpoints in those files plus directly linked counterpart
endpoints. Input paths are normalized the same way as `related` and `context`.

Human-readable output is optimized for inspection. Whole-project output is
docs-oriented:

```text
docs/auth.md
  login-spec -> src/auth/login.ts#login (bidirectional)

2 nodes, 2 edges, 1 bidirectional pair, 0 one-way edges, 0 diagnostics
```

Scoped human-readable output is grouped by each requested file, so a code file
request is code-oriented and a docs file request is docs-oriented. Pair labels
are `bidirectional`, `missing @code backlink`, or `missing @doc backlink`.

`--json` emits a node/edge graph:

- `nodes[]` are resolved endpoints (`file#fragment`) that participate in at
  least one resolved annotation edge. Code nodes include `language`.
- `edges[]` are annotation edges. `kind: "doc"` means a code-to-doc `@doc`
  annotation; `kind: "code"` means a doc-to-code `@code` annotation.
- `pairs[]` summarizes resolved code/doc relationships with
  `hasDocEdge`/`hasCodeEdge` so consumers do not need to reconstruct backlink
  completeness from raw edges.
- `diagnostics[]` contains check diagnostics relevant to the output graph.
- `summary` counts nodes, edges, code nodes, doc nodes, bidirectional pairs,
  one-way edges, and diagnostics.

`--include-content` requires `--json`. It adds lightweight content to nodes:
doc nodes include the heading text, and code nodes include the symbol name plus
JSDoc/signature text with implementation bodies omitted. Code node metadata
includes the configured language. The JSON shape is
defined by [schemas/graph-output.schema.json](../../schemas/graph-output.schema.json).

`graph` exits with code `1` for CLI invocation errors, invalid roots, and
configuration errors that prevent scanning. File read, code parse, scanner
worker, and link diagnostics are included in the output when possible; they do
not by themselves make `graph` exit non-zero.

<!-- @code src/core/context.ts#context -->
## Context Command

The context command prints the *content* of the counterparts linked from a set
of input files: where `related` answers "which files are linked", `context`
answers "what do they say". Its primary consumer is an agent hook that injects
the linked specification (or the linked code) into the agent's context before
it edits a file, so the default output is Markdown suitable for direct
injection. It takes the same input forms as `related`:

```sh
# before editing a file
docbridge context src/auth/login.ts

# uncommitted changes
git diff --name-only HEAD | docbridge context --stdin
```

Input files are passed as positional arguments, as newline-separated paths on
stdin with `--stdin`, or both combined. Invoking `context` with neither
positional files nor `--stdin` is a CLI invocation error. Input paths are
normalized exactly like `related` input paths (root-relative interpretation,
absolute-path relativization, `./` stripping, deduplication).

Counterpart resolution follows the link graph semantics used by `related` and
LSP navigation: direct links only (one hop), including resolvable one-way
links. For every linked endpoint in the input files, each counterpart
contributes one *context block*:

- A **doc counterpart** contributes its full Markdown section: the heading and
  its body up to the next heading at the same or a higher level, including
  deeper subsections, with no length cap.
- A **code counterpart** contributes its full declaration source, including
  the leading documentation block, fenced with the code language.

A counterpart linked from multiple input endpoints appears once; every linking
endpoint is recorded in its `linkedFrom` list (sorted). Blocks are ordered
deterministically by counterpart file path, then position in the file. Input
files that are not in the managed set, do not exist, or have no linked
endpoints contribute no blocks; they are only reflected in the summary count.
A counterpart whose content cannot be extracted is skipped.

Extraction is best-effort: the command reports the blocks it can resolve even
when the project has broken links. Check diagnostics located in the input
files are reported alongside the result — on stderr in human-readable mode, in
the `diagnostics` field with `--json` — and never affect the exit code, so a
temporarily broken tree still yields the context that does resolve. Validation
verdicts remain `docbridge check`'s and `related --gate`'s concern.

Human-readable output prints one block per counterpart, separated by
horizontal rules, then the summary line, which is always printed. Doc sections
are rendered raw; code declarations are fenced:

```text
docs/auth.md#login-spec (linked from src/auth/login.ts#login)

## Login Spec

The login flow.

1 input file, 1 context block
```

`--json` emits the same data as machine-readable JSON, following
[schemas/context-output.schema.json](../../schemas/context-output.schema.json):

```json
{
  "contexts": [
    {
      "endpoint": "docs/auth.md#login-spec",
      "kind": "doc",
      "filePath": "docs/auth.md",
      "startLine": 2,
      "endLine": 4,
      "linkedFrom": ["src/auth/login.ts#login"],
      "content": "## Login Spec\n\nThe login flow."
    }
  ],
  "diagnostics": [],
  "summary": { "inputFiles": 1, "contexts": 1 }
}
```

`startLine` and `endLine` are 1-based and inclusive, covering the lines of
`content` within `filePath`.

`context` exits with code `0` on success regardless of what it finds or which
diagnostics it reports. Only CLI invocation errors and configuration errors
exit with code `1`.

<!-- @code src/cli/init.ts#runInit -->
<!-- @code src/cli/init.ts#parseInitOptions -->
<!-- @code src/core/init-discovery.ts#discoverRepository -->
<!-- @code src/core/init-plan.ts#planInitCommand -->
## Init Command

The init command performs CLI-driven first-time setup for an existing
repository. It discovers likely docs and code scope, creates
`docbridge.config.json` only when scope is confirmed or unambiguous, and can
install distributable DocBridge agent skills under `.agents/skills/` and/or
`.claude/skills/`.

Shared init options:

- `--yes` accepts safe defaults without prompting. In non-interactive mode,
  ambiguous docs or code scope stops config generation instead of falling back
  to broad globs.
- `--dry-run` prints intended file operations and generated config content
  without writing files.
- `--force` overwrites existing installed skills. It never replaces an existing
  `docbridge.config.json`.
- `--agent-target <target>` selects `codex`, `claude`, `both`, or `none`
  (`none` is valid for `init` only).

When no agent directory exists, `init --yes` defaults to config-only setup
(`--agent-target none`). Interactive mode recommends Codex after confirmation.

Human-readable output reports created, skipped, and would-write operations, then
prints next steps such as reviewing `docbridge.config.json`, adding `@doc` /
`@code` annotations, and optionally running `docbridge check`.

Existing `docbridge.config.json` files are never overwritten. Valid config is
summarized; invalid config is reported with repair guidance.

<!-- @code src/cli/init.ts#runInitWithAgent -->
## Init-With-Agent Command

The init-with-agent command prepares agent-guided adoption. It installs only
`docbridge-adopt` for the selected agent target, prints one-shot command
examples, and prints fallback prompts that explicitly ask the agent to use
`docbridge-adopt`, confirm scope, and install the companion DocBridge skills
after adoption. It does not launch an agent process and does not generate
`docbridge.config.json`.

When no `.agents/` or `.claude/` directory exists, `init-with-agent --yes`
requires an explicit `--agent-target` other than `none`.

Human-readable output distinguishes created, skipped, and would-create skill
operations, then prints per-agent setup guidance for Codex and/or Claude Code.
