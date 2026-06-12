# SpecLink agent hook examples

Copyable hook scripts that wire SpecLink into an AI coding agent. They cover
the two v0.3 use cases:

- **Pre-edit context injection** — before the agent edits a TypeScript or
  Markdown file, inject the content of its linked counterparts
  (`speclink context`), so the agent reads the relevant specification (or the
  linked code) without extra file discovery.
- **Gate triage** — when the agent finishes a turn, report linked counterparts
  of uncommitted changes that were not themselves changed
  (`speclink related --gate`), together with their content, so the agent
  either updates each counterpart or justifies leaving it unchanged.

The scripts target Claude Code hook payloads. For step-by-step recipes —
including Codex and CI — see [docs/integrations/](../../docs/integrations/).

## Requirements

- `bash`, `git`, and `bun` on `PATH` (SpecLink runs on Bun, so a SpecLink
  project has it already).
- The SpecLink CLI. The scripts invoke `speclink` by default; if the CLI is
  not on `PATH`, set `SPECLINK_CMD` to the invocation that works in your
  setup, for example:

  ```sh
  SPECLINK_CMD="bun run /path/to/spec-link/src/cli/index.ts"
  ```

## Installation (Claude Code)

Copy the scripts into your repository (conventionally `.claude/hooks/`), keep
them executable, and register them in `.claude/settings.json`:

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

### `claude-pre-edit-context.sh`

`PreToolUse` hook for the `Edit` and `Write` tools. Reads the target
`file_path` from the tool input, skips files SpecLink does not manage
(anything other than `*.ts` and `*.md`), runs `speclink context <file>`, and
returns the Markdown output as `additionalContext`. Files without linked
counterparts inject nothing.

### `claude-stop-related-gate.sh`

`Stop` hook. Collects uncommitted changes (`git diff --name-only HEAD` plus
untracked files), runs `speclink related --stdin --gate --json`, and — when
counterparts were left unchanged — emits an informational `systemMessage`
listing each violation together with the counterpart content fetched via
`speclink context --stdin --json`. It never blocks the turn: judgment about
counterparts belongs to the pull request, where CI re-runs the gate over the
whole change set.

## Notes

- Both scripts are best-effort, mirroring `speclink context` itself: a broken
  link or a failed extraction drops content from the message instead of
  failing the hook.
- This repository dogfoods the same logic in its own guardrails: see
  `.claude/hooks/` (the Stop hook there additionally runs the repo's check and
  test suite first) and the Codex mirror under `.codex/hooks/`.
