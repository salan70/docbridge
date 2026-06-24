# Init Command Plan

This plan defines the first DocBridge setup flow for existing repositories. The
goal is to make first-time adoption concrete without letting the CLI rewrite
repository policy or guess broad scopes when the project structure is
ambiguous.

Normative behavior should be reflected in these specs and docs as the slices
land:

- [CLI](../specs/cli.md)
- [Codex Integration](../integrations/codex.md)
- [Claude Code Integration](../integrations/claude-code.md)

## Status

- [x] Slice 1: Init Planning and Option Parsing
- [x] Slice 2: Repository Scope Discovery
- [x] Slice 3: Config Creation
- [x] Slice 4: Agent Skill Installation
- [x] Slice 5: Init-With-Agent Flow
- [x] Slice 6: Documentation and Release Readiness

## Goals

- Add `docbridge init` for CLI-driven first-time setup.
- Add `docbridge init-with-agent` for agent-guided adoption setup.
- Generate `docbridge.config.json` only when a safe docs/code scope has been
  confirmed or unambiguously detected.
- Install DocBridge agent skills for Codex, Claude Code, both, or neither.
- Keep existing files safe by default: no implicit overwrites of config or
  installed skills.
- Provide useful completion summaries and next steps for both interactive and
  non-interactive use.

## Non-Goals

- CI workflow generation.
- Git hook or agent hook installation.
- Editing `AGENTS.md`, `CLAUDE.md`, or other repository instruction files.
- Running or controlling Codex or Claude Code as a child process.
- Fully custom non-interactive setup flags such as explicit docs/code glob
  arguments.
- Config replacement for repositories that already have
  `docbridge.config.json`.

## Decisions

### Command Split

`docbridge init` performs CLI-driven setup. It may create
`docbridge.config.json` and copy agent skills after confirmation.

`docbridge init-with-agent` prepares an agent-guided setup. It installs only
`docbridge-adopt` for the selected agent target, then prints one-shot commands
and fallback prompts that the user can run in Codex or Claude Code.

The CLI must not launch an agent process. Agent CLIs differ in authentication,
TTY behavior, current-working-directory handling, and skill invocation syntax.
Printing commands and prompts is more stable for the first implementation.

### Init Options

`docbridge init` and `docbridge init-with-agent` should support:

- `--yes`: accept safe defaults without prompting.
- `--dry-run`: print intended file operations and generated content without
  writing files.
- `--force`: overwrite existing installed skills, but not
  `docbridge.config.json`.

Detailed non-interactive scope options are deferred until after the interactive
flow is proven.

### Existing Files

Existing `docbridge.config.json` is never overwritten in this plan.

- If the config is valid, show the current scope and any detected additions.
- If the config is invalid, report the issue and show a repair direction.
- `--yes` does not modify an existing config.
- `--force` does not replace config.

Existing installed skills are safer to replace than config, but still require
explicit intent:

- Interactive mode asks whether to skip or overwrite each existing skill.
- `--yes` skips existing skills.
- `--force` overwrites existing skills.
- `--dry-run` reports copy, skip, or overwrite plans only.

### Agent Targets

Both setup commands support these agent targets:

- `codex`: install under `.agents/skills/`.
- `claude`: install under `.claude/skills/`.
- `both`: install to both locations.
- `none`: supported by `init` only, for config-only setup.

The default target is detected from existing directories:

- `.agents/` only: `codex`.
- `.claude/` only: `claude`.
- both directories: `both`.
- neither directory in interactive mode: recommend `codex`, but require user
  confirmation before creating `.agents/`.
- neither directory with `init --yes`: `none`, so the command remains
  config-only and does not create an agent directory without explicit intent.
- neither directory with `init-with-agent --yes`: stop with a message that an
  explicit agent target is required; `none` is not meaningful for
  `init-with-agent`.

`docbridge init` installs every distributable `templates/skills/docbridge-*`
skill when an agent target other than `none` is selected.

`docbridge init-with-agent` installs only `docbridge-adopt`.

### Scope Discovery

Docs scope is discovered by scanning Markdown files and grouping them by
directory. The CLI should score likely specification directories rather than
hard-code `docs/**/*.md`.

High-confidence directory names include:

- `docs/specs`
- `specs`
- `spec`
- `requirements`
- `design`
- `architecture`
- `adr`
- `decisions`

Medium-confidence names include:

- `docs`
- `documentation`
- `doc`

Default docs scope excludes general project prose such as:

- `README.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `LICENSE.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

It also excludes Markdown files under directories whose path segments match one
of these lowercased names:

- `runbook`
- `runbooks`
- `release`
- `releases`
- `changelog`
- `changelogs`
- `contributing`

The MVP should use these explicit filename and directory-segment rules only.
It should not attempt fuzzy semantic classification of Markdown content.

When docs scope is ambiguous, interactive mode must ask the user to choose. In
`--yes` mode, ambiguity should stop config generation and print a scope
confirmation message instead of falling back to `**/*.md`.

Code scope uses supported-language conventions:

- TypeScript: `src/**/*.ts`, `lib/**/*.ts`, `packages/*/src/**/*.ts`,
  `apps/*/src/**/*.ts`.
- Swift: `Sources/**/*.swift`, `*/Sources/**/*.swift`.
- Dart: `lib/**/*.dart`.

The generated scope excludes tests, generated files, and TypeScript declaration
files. If multiple supported languages are detected, all are proposed and the
interactive flow lets the user remove unwanted languages.

### Completion Output

Both commands should end with a concise summary.

`docbridge init` reports created, skipped, and would-write files, then prints
next steps such as reviewing `docbridge.config.json`, adding `@doc` / `@code`
annotations, and optionally running `docbridge check`.

`docbridge init-with-agent` reports installed or skipped skills, then prints
one-shot command examples and fallback prompts for each selected agent.

`docbridge check` is not part of the mandatory init flow. It may be offered as
a post-init next step, but a zero-link repository makes its value limited.

## Agent Workflow

AI agents should work one slice at a time.

For each slice:

1. Read the relevant spec before editing code.
2. Add or update focused Bun tests first. For logic changes, use the `tdd`
   skill.
3. Implement the minimum production code required by the tests.
4. Run `just test`.
5. Run the slice-specific verification commands listed below.
6. Keep unrelated formatting, refactors, and generated output out of the diff.

Prefer small pure functions for discovery and file-operation planning. The CLI
should call those functions and format their results, so tests can cover setup
behavior without touching real user repositories.

## Proposed Module Layout

This layout is not mandatory, but agents should avoid overlapping modules
without a clear reason.

```text
src/
  cli/
    index.ts
    init.ts              # CLI orchestration and output formatting
  core/
    init-discovery.ts    # docs/code/agent target detection
    init-plan.ts         # config and skill file-operation planning
```

Expected tests:

```text
src/
  cli/
    init.test.ts
  core/
    init-discovery.test.ts
    init-plan.test.ts
```

## Slice 1: Init Planning and Option Parsing

Purpose: add internal command planning and option parsing without exposing a
user-visible no-op command.

Tasks:

- Parse `--yes`, `--dry-run`, and `--force`.
- Reject unknown options with the existing CLI error style.
- Add internal command handlers or planning functions that return deterministic
  summaries without writing files.
- Keep `init` and `init-with-agent` out of public help until their behavior is
  implemented. If a temporary command path is needed for tests, it must fail
  clearly with exit code `1` rather than appearing to succeed.

Tests:

- Option parsing accepts the shared init options.
- Unknown options and missing values fail consistently.
- Internal handlers do not write files.
- Public help does not advertise unfinished setup commands.

Verification:

```sh
just test
```

Done when:

- Shared init options and planning behavior are covered by tests without
  shipping a visible no-op `docbridge init`.

## Slice 2: Repository Scope Discovery

Purpose: detect docs scope, code scope, and default agent target.

Tasks:

- Implement Markdown directory discovery and scoring.
- Exclude default prose and operational Markdown from docs recommendations.
- Detect supported TypeScript, Swift, and Dart code directories.
- Exclude tests, generated files, and declaration files from code candidates.
- Detect the default agent target from `.agents/` and `.claude/`.
- Represent ambiguous discovery as a structured result, not a thrown error.

Tests:

- Strong docs directories are recommended.
- README-only repositories are treated as ambiguous for docs scope.
- Default prose basenames are excluded by exact case-insensitive basename
  matching.
- Operational Markdown directories are excluded by exact case-insensitive path
  segment matching.
- Mixed-language repositories propose every supported language.
- Interactive default agent target follows the directory-detection rules.
- `init --yes` uses `none` when no agent directory exists.
- `init-with-agent --yes` requires an explicit agent target when no agent
  directory exists.

Verification:

```sh
just test
```

Done when:

- Discovery can explain both safe defaults and ambiguity without writing files.

## Slice 3: Config Creation

Purpose: generate `docbridge.config.json` only when scope is confirmed or safe.

Tasks:

- Convert confirmed discovery results into the current language-keyed config
  shape.
- Write config only when no existing config is present.
- Show existing valid config scope without replacing it.
- Report invalid existing config without replacing it.
- Make `--dry-run` print generated config content without writing.
- Make `--yes` stop when docs or code scope is ambiguous.

Tests:

- New config uses the language-keyed `include.code` object.
- Existing config is never overwritten by `--yes` or `--force`.
- Ambiguous `--yes` does not create config.
- Dry-run does not write config.

Verification:

```sh
just test
```

Done when:

- Config file operations are safe by default and the generated config passes
  existing config validation.

## Slice 4: Agent Skill Installation

Purpose: install DocBridge skills to Codex and Claude Code directories.

Tasks:

- Discover distributable skills from `templates/skills/docbridge-*`.
- Install all distributable skills for `docbridge init` when the target is not
  `none`.
- Install only `docbridge-adopt` for `docbridge init-with-agent`.
- Implement skip and overwrite behavior for existing skill directories.
- Make `--dry-run` report file-operation plans only.

Tests:

- `init` plans every DocBridge skill.
- `init-with-agent` plans only `docbridge-adopt`.
- `codex`, `claude`, and `both` map to the right destination paths.
- `init --yes` with no existing agent directory does not plan skill writes.
- Existing skills are skipped by `--yes` and overwritten by `--force`.

Verification:

```sh
just test
```

Done when:

- Skill installation behavior is covered without requiring a real agent runtime.

## Slice 5: Init-With-Agent Flow

Purpose: make agent-guided setup actionable without launching the agent.

Tasks:

- Print one-shot command examples for Codex and Claude Code.
- Print fallback prompts that explicitly ask the agent to use
  `docbridge-adopt`.
- Include the current repository path in prompts when useful.
- Make the command summary distinguish created, skipped, and would-create skill
  operations.
- Avoid config generation in `init-with-agent`.

Tests:

- Codex output includes the Codex destination path and one-shot command.
- Claude output includes the Claude destination path and one-shot command.
- `both` prints both agent sections.
- `--yes` without an existing or explicit agent target exits with a clear
  target-required message.
- No config write is planned for `init-with-agent`.

Verification:

```sh
just test
```

Done when:

- A user can run `docbridge init-with-agent` and immediately see the next
  command or prompt to start agent-guided adoption.

## Slice 6: Documentation and Release Readiness

Purpose: align user-facing docs, specs, and examples with the new commands.

Tasks:

- Update `docs/specs/cli.md` with `init` and `init-with-agent`.
- Update English and Japanese README material as needed.
- Update integration docs for Codex and Claude Code skill installation.
- Add examples of dry-run and agent-guided setup output where useful.
- Confirm package contents still include `templates/skills/`.

Tests:

- Existing CLI tests cover help text and command behavior.
- Existing package/build checks still pass.

Verification:

```sh
just check
just typecheck
just test
just build
```

Done when:

- The commands are documented, tested, and ready for a release slice.
