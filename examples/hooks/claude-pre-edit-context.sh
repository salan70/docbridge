#!/usr/bin/env bash
# Claude Code PreToolUse hook: inject the linked counterpart content of the
# file about to be edited, so the agent reads the relevant specification (or
# the linked code) before changing it.
#
# Wire it to the Edit and Write tools in .claude/settings.json; see the README
# in this directory. Requires bash, git, bun, and the SpecLink CLI.
set -euo pipefail

payload="$(cat || true)"

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

# How to invoke SpecLink. Override with e.g.
#   SPECLINK_CMD="bun run /path/to/spec-link/src/cli/index.ts"
# Intentionally unquoted below so a multi-word command splits into words.
speclink_cmd=(${SPECLINK_CMD:-speclink})

file_path="$(
  PAYLOAD="$payload" bun -e '
    try {
      const payload = JSON.parse(process.env.PAYLOAD || "{}");
      console.log(payload.tool_input?.file_path ?? "");
    } catch {
      console.log("");
    }
  '
)"

# SpecLink manages TypeScript and Markdown only; skip everything else without
# paying for a project scan.
case "$file_path" in
  *.ts | *.md) ;;
  *) exit 0 ;;
esac

context_out="$("${speclink_cmd[@]}" context "$file_path" 2>/dev/null || true)"

# The summary line is always printed last; a zero count means the file has no
# linked counterparts and nothing to inject.
summary_line="$(printf '%s\n' "$context_out" | tail -n 1)"
case "$summary_line" in
  *", 0 context blocks") exit 0 ;;
  "") exit 0 ;;
esac

FILE_PATH="$file_path" CONTEXT_OUT="$context_out" bun -e '
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: [
        `SpecLink: linked counterpart content for ${process.env.FILE_PATH} (read before editing; if the edit changes documented behavior, update the counterpart too):`,
        "",
        process.env.CONTEXT_OUT,
      ].join("\n"),
    },
  }));
'
