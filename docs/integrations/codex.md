# Codex integration

How to wire SpecLink into Codex with project-local hooks, mirroring the
[Claude Code integration](claude-code.md) in intent.

Codex loads project-local hooks only after they are reviewed and trusted with
the `/hooks` command, and a hook must be re-trusted whenever its script
changes. If hooks do not appear to fire, check `/hooks` first, and treat the
hooks as best-effort awareness rather than a hard guard.

## Hook configuration

This repository's Codex setup lives under `.codex/`:
[`hooks.json`](../../.codex/hooks.json) registers the hook events and the
scripts live in [`.codex/hooks/`](../../.codex/hooks/).

- **On-edit counterpart awareness** —
  [`.codex/hooks/on-edit-context.sh`](../../.codex/hooks/on-edit-context.sh)
  runs on `PostToolUse` for the editing tools. It reads the target `file_path`
  from the tool input, runs `speclink context <file>`, and returns the
  Markdown output as additional context so the agent reconciles the edit
  against the counterpart. Files SpecLink does not manage, and files without
  linked counterparts, inject nothing. (It mirrors the Claude Code hook, which
  is `PostToolUse` rather than `PreToolUse` because a `PreToolUse` hook's
  additional context is delivered only after the edit runs.)
- **Gate triage on Stop** —
  [`.codex/hooks/stop-verify.sh`](../../.codex/hooks/stop-verify.sh) reports
  `speclink related --gate` findings over uncommitted changes as information
  and attaches the flagged counterpart content fetched via
  `speclink context --stdin --json`. (In this repository the same script also
  runs the project checks first; for a SpecLink-only Stop hook, start from
  [`examples/hooks/claude-stop-related-gate.sh`](../../examples/hooks/claude-stop-related-gate.sh)
  — the payload handling is shell-portable.)

To adopt the integration in another repository, copy the scripts from
[`examples/hooks/`](../../examples/hooks/) and register them in your Codex
hook configuration the same way `.codex/hooks.json` does here. The scripts
accept a `SPECLINK_CMD` override when `speclink` is not on `PATH`.

## Keeping the stacks in sync

When a repository serves both Claude Code and Codex (as this one does), keep
the two hook stacks equivalent in intent but separate in assets: Claude Code
reads `.claude/settings.json` and `$CLAUDE_PROJECT_DIR`, while the Codex
scripts resolve the repository root with `git rev-parse --show-toplevel`. Do
not point both tools at one shared script directory if their payload or
environment contracts drift.
