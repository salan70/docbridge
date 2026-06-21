# Codex integration

How to wire DocBridge into Codex with project-local hooks, mirroring the
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
  from the tool input, runs `docbridge context <file>`, and returns the
  Markdown output as additional context so the agent reconciles the edit
  against the counterpart. Files DocBridge does not manage, and files without
  linked counterparts, inject nothing. (It mirrors the Claude Code hook, which
  is `PostToolUse` rather than `PreToolUse` because a `PreToolUse` hook's
  additional context is delivered only after the edit runs.)
- **Gate triage on Stop** —
  [`.codex/hooks/stop-verify.sh`](../../.codex/hooks/stop-verify.sh) reports
  `docbridge related --gate` findings over uncommitted changes as information
  and attaches the flagged counterpart content fetched via
  `docbridge context --stdin --json`. (In this repository the same script also
  runs the project checks first; for a DocBridge-only Stop hook, start from
  [`examples/hooks/claude-stop-related-gate.sh`](../../examples/hooks/claude-stop-related-gate.sh)
  — the payload handling is shell-portable.)

To adopt the integration in another repository, copy the scripts from
[`examples/hooks/`](../../examples/hooks/) and register them in your Codex
hook configuration the same way `.codex/hooks.json` does here. The scripts
accept a `DOCBRIDGE_CMD` override when `docbridge` is not on `PATH`.

## Skills

[`templates/skills/`](../../templates/skills/) ships agent skills that also
work as Codex-style project skills. Install them with `docbridge init` (all
DocBridge skills) or `docbridge init-with-agent` (`docbridge-adopt` first;
`docbridge-adopt` installs the companion skills after scope is confirmed), or
copy individual skill directories to `.agents/skills/` when you prefer manual
setup:

- `docbridge-annotate` — create correct `@doc`/`@code` link pairs and verify
  them with `docbridge check`.
- `docbridge-sync` — triage `related --gate` findings using `docbridge context`,
  then update the counterpart or justify the divergence.
- `docbridge-adopt` — adopt DocBridge in an existing TypeScript, Swift, or Dart
  project by confirming docs/code scope, creating or improving config, and
  installing the companion DocBridge skills.
- `docbridge-link` — link existing docs sections to existing exported
  supported code declarations with section-level confirmation.
- `docbridge-review` — review all existing links for semantic validity using
  `docbridge graph --json --include-content`.

This repository keeps the distributable DocBridge skills canonical under
`templates/skills/` and dogfoods them as skill-level symlinks from
`.agents/skills/`. External repositories should usually copy the skill
directories so they remain self-contained.

## Keeping the stacks in sync

When a repository serves both Claude Code and Codex (as this one does), keep
the two hook stacks equivalent in intent but separate in assets: Claude Code
reads `.claude/settings.json` and `$CLAUDE_PROJECT_DIR`, while the Codex
scripts resolve the repository root with `git rev-parse --show-toplevel`. Do
not point both tools at one shared script directory if their payload or
environment contracts drift.
