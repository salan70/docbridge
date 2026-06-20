# DocBridge agent hook examples

Copyable hook scripts that wire DocBridge into an AI coding agent. They cover
the two v0.3 use cases:

- **On-edit counterpart awareness** — when the agent edits a managed code or
  Markdown file, surface the content of its linked counterparts
  (`docbridge context`), so the agent reconciles the edit against the relevant
  specification (or the linked code) without extra file discovery.
- **Gate triage** — when the agent finishes a turn, report linked counterparts
  of uncommitted changes that were not themselves changed
  (`docbridge related --gate`), together with their content, so the agent
  either updates each counterpart or justifies leaving it unchanged.

The scripts target Claude Code hook payloads. For step-by-step recipes —
including Codex and CI — see [docs/integrations/](../../docs/integrations/).

> A note on timing: the awareness hook is a `PostToolUse` hook, not
> `PreToolUse`. Claude Code delivers a `PreToolUse` hook's `additionalContext`
> next to the tool result (after the edit runs), so it cannot enforce
> read-before-editing; surfacing the counterpart immediately after the edit is
> the honest, documented behavior. The gate-triage hook returns its feedback as
> Stop `additionalContext` (injected into the agent's context), not
> `systemMessage` (a user-facing warning the model never sees).

## Requirements

- `bash`, `git`, and `bun` on `PATH` (DocBridge runs on Bun, so a DocBridge
  project has it already).
- The DocBridge CLI. The scripts invoke `docbridge` by default; if the CLI is
  not on `PATH`, set `DOCBRIDGE_CMD` to the invocation that works in your
  setup, for example:

  ```sh
  DOCBRIDGE_CMD="bun run /path/to/docbridge/src/cli/index.ts"
  ```

## Installation (Claude Code)

Copy the scripts into your repository (conventionally `.claude/hooks/`), keep
them executable, and register them in `.claude/settings.json`:

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
    ],
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

## Scripts

### `claude-on-edit-context.sh`

`PostToolUse` hook for the `Edit` and `Write` tools. Reads the target
`file_path` from the tool input, lets DocBridge decide whether the file is
managed by the project's language-keyed config, runs `docbridge context <file>`,
and returns the Markdown output as `additionalContext`. Files without linked
counterparts inject nothing.

### `claude-stop-related-gate.sh`

`Stop` hook. Collects uncommitted changes (`git diff --name-only HEAD` plus
untracked files), runs `docbridge related --stdin --gate --json`, and — when
counterparts were left unchanged — returns Stop `hookSpecificOutput`
`additionalContext` listing each violation together with the counterpart
content fetched via `docbridge context --stdin --json`. It never blocks the
turn: the conversation continues with the context attached, and judgment about
counterparts belongs to the pull request, where CI re-runs the gate over the
whole change set.

## Notes

- Both scripts are best-effort, mirroring `docbridge context` itself: a broken
  link or a failed extraction drops content from the output instead of
  failing the hook.
- This repository dogfoods the same logic in its own guardrails: see
  `.claude/hooks/` (the Stop hook there additionally runs the repo's check and
  test suite first) and the Codex mirror under `.codex/hooks/`.
