# Claude Code integration

How to wire SpecLink into [Claude Code](https://claude.com/claude-code) so the
agent reconciles its edits against the linked specification and triages
unchanged counterparts before finishing a turn.

Both recipes consume the SpecLink CLI. If `speclink` is not on `PATH`, the
example scripts accept a `SPECLINK_CMD` override, for example
`SPECLINK_CMD="bun run /path/to/spec-link/src/cli/index.ts"`.

## On-edit counterpart awareness

Goal: when Claude Code edits a managed code or Markdown file, surface the
content of the file's linked counterparts so the agent reconciles the edit
against the relevant specification (or the linked code) without extra file
discovery.

This is a `PostToolUse` hook, not `PreToolUse`. Claude Code delivers a
`PreToolUse` hook's `additionalContext` next to the tool result — after the
edit has already run — so it cannot enforce read-before-editing. Surfacing the
counterpart immediately after the edit, while the agent can still act on it
before moving on, is the documented behavior.

1. Copy [`examples/hooks/claude-on-edit-context.sh`](../../examples/hooks/claude-on-edit-context.sh)
   into your repository, conventionally `.claude/hooks/`.
2. Register it as a `PostToolUse` hook for the editing tools in
   `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Edit|MultiEdit|Write",
           "hooks": [
             {
               "type": "command",
               "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/claude-on-edit-context.sh\"",
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
changes and, when counterparts were left unchanged, returns Stop
`hookSpecificOutput` `additionalContext` that lists each violation and attaches
the counterpart content fetched via `speclink context --stdin --json`. It uses
`additionalContext` (injected into the agent's context for it to act on) rather
than `systemMessage` (a user-facing warning the model never sees), and never
blocks the turn — the conversation continues with the context attached. Pair it
with the [CI recipe](ci.md) so the pull request remains the enforcement point.

## Skills

[`templates/skills/`](../../templates/skills/) ships Claude Code skills that
consume the same commands. Copy the skills you want into your repository's
`.claude/skills/` directory:

- `speclink-annotate` — create correct `@doc`/`@code` link pairs and verify
  them with `speclink check`.
- `speclink-sync` — triage `related --gate` findings using `speclink context`,
  then update the counterpart or justify the divergence.
- `speclink-adopt` — adopt SpecLink in an existing TypeScript, Swift, or Dart
  project by confirming docs/code scope and creating or improving config.
- `speclink-link` — link existing docs sections to existing exported
  supported code declarations with section-level confirmation.
- `speclink-review` — review all existing links for semantic validity using
  `speclink graph --json --include-content`.

Claude Code discovers project skills at `.claude/skills/<skill-name>/SKILL.md`.
This repository keeps the distributable SpecLink skills canonical under
`templates/skills/` and dogfoods them as skill-level symlinks from
`.claude/skills/`. External repositories should usually copy the skill
directories so they are not tied to this repository's checkout path.

## Dogfooding reference

This repository wires the same integration into its own guardrails:
[`.claude/settings.json`](../../.claude/settings.json) registers
[`.claude/hooks/on-edit-context.sh`](../../.claude/hooks/on-edit-context.sh)
and a `Stop` hook that runs the repo's checks before reporting gate findings
with counterpart content. Treat it as a known-good reference for payload
handling and output formats.
