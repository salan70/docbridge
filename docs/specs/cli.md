# CLI

DocBridge provides the `check`, `related`, `context`, `graph`, `docs`, `init`,
`init-with-agent`, `upgrade`, and `lsp` commands.

```sh
docbridge [--version] [--help]
docbridge check [--root <path>] [--json] [--audit]
docbridge related [--root <path>] [--json] [--stdin] [--gate] [files...]
docbridge context [--root <path>] [--json] [--stdin] [files...]
docbridge graph [--root <path>] [--json] [--include-content] [--stdin] [files...]
docbridge docs list [--json]
docbridge docs show <name>
docbridge init [--root <path>] [--yes] [--dry-run] [--force] [--agent-target <target>]
docbridge init-with-agent [--root <path>] [--yes] [--dry-run] [--force] [--agent-target <target>]
docbridge upgrade [--root <path>] [--check] [--dry-run] [--yes] [--force] [--agent-target <target>]
docbridge lsp
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

`--audit` enables audit-only diagnostics: `undocumented_symbol` for in-scope code endpoints with no `@doc`, and `unlinked_doc_section` for in-scope documentation sections with no `@code`. Both are warnings, so `--audit` does not change exit codes. See [Diagnostics](diagnostics.md).

`--version` (alias `-v`) prints the DocBridge version on stdout and exits with code `0`. `--help` (alias `-h`) prints usage on stdout and exits with code `0`. See [Help](#help) for per-command help.

Human-readable output prints one diagnostic per line, then the summary, then a
troubleshooting pointer. The pointer is printed on every human-readable `check`
run, including clean ones, and is omitted under `--json`:

```text
docs/specs/cli.md:12:1 error doc_anchor_not_found docs/specs/missing.md#check-command - Documentation anchor not found.
src/cli/index.ts:3:1 warning duplicate_link docs/specs/cli.md#check-command - Duplicate link annotation.

Summary: 1 error, 1 warning
See `docbridge docs show troubleshooting` for diagnostic codes and fixes.
```

Diagnostics without a location use the target without line and column:

```text
docbridge.config.json error config_file_invalid - Failed to parse config file.
```

CLI option errors, unknown options, missing option values, and invalid roots are written to stderr and exit with code `1`. They do not emit diagnostic JSON, even when `--json` is present.

<!-- @code src/cli/errors.ts#formatCliError -->
<!-- @code src/core/suggest.ts#nearestMatch -->

## Error guidance

CLI invocation errors keep the failure on the first line and append the next
action below it. The complete error and its guidance are written to stderr;
stdout remains empty. They continue to exit with code `1`.

Unknown commands list every command from the dispatcher. A close spelling or
ordered abbreviation adds a `Did you mean` line. The list and suggestion are
derived from the same command set used by dispatch and help:

```text
Error: Unknown command: ctx

Available commands:
  check, related, context, graph, init, init-with-agent, lsp

Did you mean `context`?

Run `docbridge --help` for usage.
```

Unknown options and missing option values identify the command-specific help
that explains the accepted flags. Missing project roots include a runnable
`--root .` example. `related` and `context` require either positional input
files or `--stdin`; when neither is supplied, the error includes both forms:

```text
Error: No input files were provided.

Provide file paths as arguments:

  docbridge context src/auth.ts

Or read newline-separated paths from stdin:

  git diff --name-only | docbridge context --stdin

Run `docbridge context --help` for command usage.
```

When human-readable `check` output reports a missing configuration as
`config_file_invalid`, setup guidance is written to stderr:

```text
Run one of:

  docbridge init
  docbridge init --dry-run

For agent-guided adoption:

  docbridge init-with-agent
```

The diagnostic and summary remain in the normal human-readable check output.
If `docbridge.config.json` exists but cannot be parsed, stderr instead directs
the user to repair or delete it before re-running `docbridge check`.
The `--json` path emits the same JSON as before and does not include human
guidance.

<!-- @code src/cli/help.ts#commandHelp -->

## Help

Every command supports `--help` (alias `-h`). `docbridge <command> --help`
prints that command's help on stdout and exits with code `0`, for all of
`check`, `related`, `context`, `graph`, `docs`, `init`, `init-with-agent`,
`upgrade`, and `lsp`.
Nothing is written to stderr.

The help flag is honored before any other option is validated, so
`docbridge context --nonexistent --help` prints help instead of an
unknown-option error, and `docbridge lsp --help` prints help instead of
starting the server. The flag is recognized anywhere in the argument list.

Per-command help has three sections:

```text
Usage:
  docbridge context [options] [files...]

Description:
  Print the content of the counterparts linked from the given files.
  Use it before modifying a linked code or Markdown file, so the change can be
  reconciled against its counterpart. The default Markdown output is suitable
  for inclusion in an agent prompt.

Options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --stdin        Read newline-separated file paths from stdin.
  --help, -h     Print this help text.
```

The description states _when_ to use the command, not only what it prints, so
that commands with adjacent purposes — `related`, `context`, and `graph` — can
be told apart without running them. Every option the command's parser accepts
appears in its help text; the global help lists the same option tables and one
`when to use` summary per command, and points at `docbridge <command> --help`
for the full description.

`docbridge --version` output is unaffected: it stays exactly `<version>\n`.

<!-- @code src/cli/index.ts#run -->
<!-- @code src/core/resolver.ts#check -->

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
counterpart whose file is not itself in the change set (a _violation_), prints
only those, and exits with code `1` when at least one exists. The check is
symmetric, mirroring the bidirectional link graph: a changed code file with an
unchanged linked doc is a violation, and a changed doc with an unchanged
linked code file is one too.

A violation does not necessarily mean the counterpart must change; it means
nobody has decided yet. The intended consumer is a guardrail (a Git hook or a
CI step) that asks the author to either update the counterpart or explicitly
justify leaving it unchanged. Deciding what counts as the change set (staged
files, working tree, PR diff) remains the caller's concern, the same as in the
default mode.

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

The context command prints the _content_ of the counterparts linked from a set
of input files: where `related` answers "which files are linked", `context`
answers "what do they say". Its primary consumers are a Git hook, a CI step, or
a direct invocation that needs the linked specification (or the linked code)
alongside a change, so the default output is Markdown suitable for direct
injection into a report or an agent's context. It takes the same input forms as
`related`:

```sh
# a single file
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
contributes one _context block_:

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

<!-- @code src/cli/docs.ts#runDocs -->

## Documentation Commands

`docbridge docs list` discovers every `.md` file under the installed package's
`docs/user/` directory. A document name is its filename without `.md`. The
canonical names are `getting-started`, `configuration`, `linking`, `commands`,
`automation`, and `troubleshooting`. Every document must start with YAML
frontmatter containing a non-empty, single-line `description`; an invalid
document makes the command fail instead of being silently omitted.

Human-readable list output sorts documents by name, aligns descriptions after
the longest name, and ends with this hint:

```text
Run `docbridge docs show <name>` to read a document.
```

`docs list --json` writes a two-space-indented JSON object followed by a newline:

```json
{
  "documents": [
    {
      "name": "commands",
      "description": "Choose between check, related, context, and graph."
    }
  ],
  "help": "Run `docbridge docs show <name>` to read a document."
}
```

`docbridge docs show <name>` removes the YAML frontmatter, its single separating
blank line, and DocBridge link-annotation comments outside fenced code blocks.
It writes the remaining Markdown body to stdout without modifying other
content. Every name returned by `docs list` must be readable. An unknown name
writes an error plus all available names to stderr, leaves stdout empty, and
exits with code `1`.

`docs show` accepts only the canonical names returned by `docs list`. The
removed names `annotations`, `linking-workflow`, and `link-review` use the
unknown-name behavior; use `linking`. The removed name `agent-integration` also
uses the unknown-name behavior; use `automation`.

If `docs/user` is missing or contains no Markdown documents, both operations
report that documentation is unavailable, direct the user to reinstall
DocBridge, and exit with code `1`.

The package allowlist contains `docs/user` and excludes the developer-facing
`docs/specs`, `docs/decisions`, `docs/contributing`, `docs/plans`, and `docs/ja`
trees. The npm packed-package smoke test installs the tarball without a
repository checkout and exercises `docs list --json`, all canonical names, the
removed names, and an unknown name under both Node.js and Bun.

<!-- @code src/cli/init.ts#runInit -->
<!-- @code src/cli/init.ts#parseInitOptions -->
<!-- @code src/setup/init-discovery.ts#discoverRepository -->
<!-- @code src/setup/init-plan.ts#planInitCommand -->

## Init Command

The init command performs CLI-driven first-time setup for an existing
repository. It discovers likely docs and code scope, creates
`docbridge.config.json` only when scope is confirmed or unambiguous, and can
install the distributable `docbridge` skill under `.agents/skills/` and/or
`.claude/skills/`.

Shared init options:

- `--yes` accepts safe defaults without prompting. In non-interactive mode,
  ambiguous docs or code scope stops config generation instead of falling back
  to broad globs.
- `--dry-run` prints intended file operations and generated config content
  without writing files.
- `--force` overwrites the installed `docbridge` skill and removes leftover
  directories from the previous five-skill layout (`docbridge-adopt`,
  `docbridge-annotate`, `docbridge-link`, `docbridge-review`,
  `docbridge-sync`). It never replaces an existing `docbridge.config.json`,
  and it never removes a skill directory that is a symlink.
- `--agent-target <target>` selects `codex`, `claude`, `both`, or `none`
  (`none` is valid for `init` only).

When no agent directory exists, `init --yes` defaults to config-only setup
(`--agent-target none`). Interactive mode recommends Codex after confirmation.

Human-readable output reports created, skipped, would-write, and would-remove
operations, then prints next steps such as reviewing `docbridge.config.json`,
adding `@doc` / `@code` annotations, and optionally running `docbridge check`.
Plain `init` reports leftover five-skill directories and leaves them in place;
`--force --dry-run` shows `would-remove`.

Existing `docbridge.config.json` files are never overwritten. Valid config is
summarized; invalid config is reported with repair guidance.

<!-- @code src/setup/version.ts#isNewerStableVersion -->
<!-- @code src/setup/registry.ts#resolveLatestStableVersion -->

## Version Discovery

DocBridge discovers the latest published release from the public npm registry
at `https://registry.npmjs.org/docbridge/latest`. The lookup is deliberately
independent of the local npm configuration: a project `.npmrc`, a registry
mirror setting, or a missing package manager cannot change the answer.
`DOCBRIDGE_REGISTRY_URL` overrides the endpoint for a mirror or for tests.

Only fully stable `X.Y.Z` versions participate. A `latest` dist-tag pointing at
a prerelease is treated as no answer at all, and a prerelease build of the CLI
never reports itself as outdated. Comparison is numeric on major, then minor,
then patch.

The request is bounded by a short timeout (1.5 seconds). Every failure —
timeout, offline, non-2xx response, unparsable body, prerelease version —
resolves to `unavailable` rather than raising. No lookup failure ever changes a
command's exit code or its stdout.

<!-- @code src/setup/update-cache.ts#resolveUpdateCachePath -->

### Update Check Cache

Lookups are cached per user, not per project, so the daily budget is shared by
every repository on the machine. The file is
`$XDG_CACHE_HOME/docbridge/update-check.json`, falling back to
`~/.cache/docbridge/update-check.json`; `DOCBRIDGE_UPDATE_CACHE` names it
directly.

The record stores a schema number, the epoch milliseconds of the lookup, and
either the latest stable version or `null` for a lookup that failed. A record
is fresh for 24 hours. A record with an unknown schema, a missing or malformed
field, unparsable JSON, or a future timestamp is ignored and the lookup is
retried; an unwritable cache is ignored entirely. Failures are cached too, so
an offline machine attempts the registry at most once per window.

`upgrade` bypasses a fresh record and always requests the registry, because the
user asked for the diagnosis. Every other command reads the cache only.

`DOCBRIDGE_NO_UPDATE_CHECK` suppresses the lookup for every command, `upgrade`
included: the variable names the check, not the notice, so setting it keeps
DocBridge off the network entirely. `upgrade` then reports the latest version as
`unknown` and still reports local asset state.

<!-- @code src/setup/update-notice.ts#decideUpdateCheck -->
<!-- @code src/setup/update-notice.ts#formatUpdateNotice -->

## Update Notification

When a newer stable release exists, a human-readable invocation prints one
concise notice to stderr after the command's own output:

```text
Update available: docbridge 0.8.0 -> 0.9.0
Upgrade command (project install): bun add -d docbridge@latest
Run `docbridge upgrade --check` for details, or set DOCBRIDGE_NO_UPDATE_CHECK=1 to silence this notice.
```

The notice never reaches stdout and never changes the exit code, so existing
consumers of DocBridge output are unaffected. It is printed only after the
command completes without a CLI invocation error.

The check is suppressed, and no registry request is made at all, when any of
the following holds:

| Condition                                                                    | Reason          |
| ---------------------------------------------------------------------------- | --------------- |
| `DOCBRIDGE_NO_UPDATE_CHECK` set to a value other than empty, `0`, or `false` | opt-out         |
| `CI` set to a value other than empty, `0`, or `false`                        | CI              |
| stderr is not a TTY                                                          | non-TTY         |
| `--json` appears anywhere in the arguments                                   | JSON output     |
| the command is `lsp` or `upgrade`                                            | machine command |

`lsp` is suppressed because the language server owns the stream; `upgrade`
reports the same information in its own output.

<!-- @code src/setup/upgrade-guidance.ts#detectUpgradeGuidance -->

## Upgrade Guidance

DocBridge never upgrades itself. It is consumed through Bun, npm, pnpm, Yarn,
global installs, and package-manager runners, so invoking one of them would
make the real install state implicit and could disagree with the project's
lockfile. Instead the CLI prints the command to run.

The package manager is read from `npm_config_user_agent`, which every major
manager sets for the processes it spawns; a direct binary invocation leaves it
unset.

The install scope is decided by the running package's _install base_: the
directory holding the first `node_modules` component of its path.
`/repo/node_modules/docbridge` and the pnpm shape
`/repo/node_modules/.pnpm/docbridge@1.0.0/node_modules/docbridge` both resolve
to `/repo`. The scope is `project` when that base is, or is an ancestor of,
either the project root the command acted on (the `--root` value) or the current
directory; `global` when it is neither; and `unknown` when the package has no
`node_modules` component at all, as in a source checkout.

Both roots matter. `docbridge check --root /repo` run from another directory,
and a bare invocation from `/repo/packages/web`, are both project installs.
Deciding from the current directory alone would call them global and send the
user to upgrade a different installation than the one that produced the
message.

An undetected manager falls back to npm and an undetected scope uses the
project-dependency form. The remaining managers are listed as alternatives, so
the output is always actionable even when nothing was detected:

```text
Upgrade command (project install): bun add -d docbridge@latest
Other package managers: npm install --save-dev docbridge@latest, pnpm add -D docbridge@latest, yarn add -D docbridge@latest
```

<!-- @code src/setup/skill-assets.ts#classifyManagedPath -->
<!-- @code src/setup/skill-assets.ts#compareSkillTree -->
<!-- @code src/setup/skill-assets.ts#applySkillOperation -->

## Managed Skill Assets

`init` and `upgrade` manage exactly one directory per agent destination:
`.agents/skills/docbridge` and/or `.claude/skills/docbridge`. Both commands
share one executor and one symlink guard.

A destination is classified before it is touched, and every path component
between the project root and the destination is inspected — not only the final
one. Checking the leaf alone is not enough: with `.agents/skills` or
`.claude/skills` symlinked to a shared directory, `lstat` on
`.claude/skills/docbridge-adopt` reports the ordinary directory inside the link
target, and a removal would delete a tree outside the selected project root.

The classification has six outcomes, and only two of them are ever written to or
removed:

| Kind               | Meaning                                               | Operations allowed        |
| ------------------ | ----------------------------------------------------- | ------------------------- |
| `absent`           | nothing there yet                                     | create                    |
| `directory`        | an ordinary directory reached through directories     | create, overwrite, remove |
| `symlink`          | the destination itself is a symlink                   | none                      |
| `symlinked-parent` | a component below the project root is a symlink       | none                      |
| `non-directory`    | the destination exists but is not a directory         | none                      |
| `blocked-parent`   | a component below the project root is not a directory | none                      |

A symlink is never created over, overwritten, or removed, because it is how a
repository shares one authoritative copy of the skill. The classification is
repeated immediately before the filesystem call, not only while planning, so a
path that changed shape in between is still left alone.

Overwrite replaces rather than merges: the destination tree is removed and the
packaged template is copied in its place, so a file the template no longer ships
does not survive a `--force` run. This is what makes a forced migration
idempotent — the following `upgrade --check` reports the skill as `up-to-date`.

Drift is detected by comparing the installed directory against the packaged
template file by file. The comparison reports changed files (present in both,
differing bytes), missing files (in the template, absent locally), and extra
files (local only). Any non-empty list makes the directory _modified_.

<!-- @code src/setup/upgrade-plan.ts#planUpgrade -->
<!-- @code src/cli/upgrade.ts#parseUpgradeOptions -->
<!-- @code src/cli/upgrade.ts#runUpgrade -->

## Upgrade Command

The upgrade command reports version drift and reconciles managed agent assets
using the currently running binary.

```sh
docbridge upgrade --check
docbridge upgrade --dry-run
docbridge upgrade --force --yes
```

Options:

- `--check` is a read-only diagnostic. It reports the installed version, the
  latest stable version, package-manager guidance, the managed skill state,
  legacy skill directories, symlinks, and locally modified files. It plans no
  operations at all, even when combined with `--force` or `--yes`.
- `--dry-run` prints the complete operation plan without writing files.
  Operations render as `would create`, `would overwrite`, and `would remove`.
- `--force` replaces the managed `docbridge` skill with the packaged template
  and removes leftover directories from the previous five-skill layout
  (`docbridge-adopt`, `docbridge-annotate`, `docbridge-link`,
  `docbridge-review`, `docbridge-sync`). No other name is ever removed, and
  removal requires an ordinary directory reached through ordinary directories:
  a symlink, a regular file carrying a legacy name, and anything under a
  symlinked `.agents/skills` or `.claude/skills` are all reported and
  preserved. See [Managed Skill Assets](#managed-skill-assets).
- `--yes` confirms destructive operations without prompting.
- `--root <path>` selects the project root.
- `--agent-target <target>` selects `codex`, `claude`, `both`, or `none`.
  Without it, the destinations are those an existing `.agents/` or `.claude/`
  directory implies; `none` reports versions only.

Without `--force`, an existing managed skill directory is preserved and
reported under `Pending migration:` instead of being replaced; legacy
directories are reported the same way. An absent managed skill is installed
without `--force`, because creating a missing directory destroys nothing.

Destructive operations (overwrite, remove) need confirmation. On a TTY the
command asks once and applies nothing when the answer is no. Without a TTY and
without `--yes` the command is a CLI invocation error, so a non-interactive run
cannot silently replace local edits.

The command's scope is the managed skill directories and nothing else. It never
modifies the CLI package, `docbridge.config.json`, Git hooks, CI recipes,
integration recipes, user code, or any other copied file, and it never runs a
package manager.

When the running binary is older than the registry's latest stable release, the
command prints the package-manager command and explains that `docbridge
upgrade` should be re-run afterwards, so managed assets are reconciled from the
new binary's templates.

The managed skill and each legacy entry are reported with the classification
from [Managed Skill Assets](#managed-skill-assets). `up-to-date`, `modified`,
and `template-missing` describe an ordinary managed directory; `absent`,
`symlink`, `symlinked-parent`, `non-directory`, and `blocked-parent` name a path
shape the command refuses to write to, each with a message explaining why
nothing happened.

Human-readable output leads with the version report, then guidance, messages,
and the sections that apply:

```text
DocBridge 0.8.0 (latest stable: 0.9.0)
Status: outdated
Upgrade command (project install): bun add -d docbridge@latest
Other package managers: npm install --save-dev docbridge@latest, pnpm add -D docbridge@latest, yarn add -D docbridge@latest

The running binary is older than the latest stable release. DocBridge does not upgrade itself: run `bun add -d docbridge@latest`, then re-run `docbridge upgrade` so managed assets are reconciled from the new binary.

Managed skills:
- .claude/skills/docbridge: modified
    changed: SKILL.md
    extra: local-notes.md

Legacy skills:
- .claude/skills/docbridge-link (directory)

Pending migration:
- .claude/skills/docbridge is locally modified and was preserved. Re-run with --force to replace it with the packaged template.

Next steps:
- Upgrade the CLI with the command above, then re-run `docbridge upgrade`.
```

When the registry cannot be reached, the latest version renders as `unknown`,
the status is `unknown`, and only local asset state is reported. `upgrade`
exits with code `0` in every case except a CLI invocation error, so it is safe
to run as a diagnostic without gating anything on its exit code.

<!-- @code src/cli/init.ts#runInitWithAgent -->

## Init-With-Agent Command

The init-with-agent command prepares agent-guided adoption. It installs the
same `docbridge` skill as `init` for the selected agent target, prints one-shot
command examples, and prints fallback prompts that explicitly ask the agent to
use the `docbridge` skill, confirm scope, and suggest the next linking steps.
It does not launch an agent process and does not generate
`docbridge.config.json`.

When no `.agents/` or `.claude/` directory exists, `init-with-agent --yes`
requires an explicit `--agent-target` other than `none`.

Human-readable output distinguishes created, skipped, and would-create skill
operations, then prints per-agent setup guidance for Codex and/or Claude Code.
