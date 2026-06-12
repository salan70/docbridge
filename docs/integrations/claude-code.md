# Claude Code integration

How to wire SpecLink into [Claude Code](https://claude.com/claude-code) so the
agent reads linked specifications before editing code and triages unchanged
counterparts before finishing a turn.

Both recipes consume the SpecLink CLI. If `speclink` is not on `PATH`, the
example scripts accept a `SPECLINK_CMD` override, for example
`SPECLINK_CMD="bun run /path/to/spec-link/src/cli/index.ts"`.

## Pre-edit context injection

Goal: before Claude Code edits a TypeScript or Markdown file, inject the
content of the file's linked counterparts so the relevant specification (or
the linked code) is in context without extra file discovery.

1. Copy [`examples/hooks/claude-pre-edit-context.sh`](../../examples/hooks/claude-pre-edit-context.sh)
   into your repository, conventionally `.claude/hooks/`.
2. Register it as a `PreToolUse` hook for the editing tools in
   `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Edit|MultiEdit|Write",
           "hooks": [
             {
               "type": "command",
               "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/claude-pre-edit-context.sh\"",
               "timeout": 30
             }
           ]
         }
       ]
     }
   }
   ```

The hook reads the target `file_path` from the tool input, runs
`speclink context <file>`, and returns the Markdown output as
`additionalContext`. Files SpecLink does not manage, and files without linked
counterparts, inject nothing. `speclink context` is best-effort by design: a
temporarily broken link drops that block instead of failing the hook.

## Gate triage on Stop

Goal: when Claude Code finishes a turn, surface linked counterparts of
uncommitted changes that were not themselves changed — together with their
content — so the agent either updates each counterpart or justifies leaving it
unchanged in its final report.

1. Copy [`examples/hooks/claude-stop-related-gate.sh`](../../examples/hooks/claude-stop-related-gate.sh)
   into your repository.
2. Register it as a `Stop` hook:

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/claude-stop-related-gate.sh\"",
               "timeout": 60
             }
           ]
         }
       ]
     }
   }
   ```

The hook runs `speclink related --stdin --gate --json` over the uncommitted
changes and, when counterparts were left unchanged, emits an informational
`systemMessage` that lists each violation and attaches the counterpart content
fetched via `speclink context --stdin --json`. It never blocks the turn; pair
it with the [CI recipe](ci.md) so the pull request remains the enforcement
point.

## Skills

[`templates/skills/`](../../templates/skills/) ships two Claude Code skills
that consume the same commands. Copy them into your repository's
`.claude/skills/` directory:

- `speclink-annotate` — create correct `@doc`/`@code` link pairs and verify
  them with `speclink check`.
- `speclink-sync` — triage `related --gate` findings using `speclink context`,
  then update the counterpart or justify the divergence.

## Dogfooding reference

This repository wires the same integration into its own guardrails:
[`.claude/settings.json`](../../.claude/settings.json) registers
[`.claude/hooks/pre-edit-context.sh`](../../.claude/hooks/pre-edit-context.sh)
and a `Stop` hook that runs the repo's checks before reporting gate findings
with counterpart content. Treat it as a known-good reference for payload
handling and output formats.
