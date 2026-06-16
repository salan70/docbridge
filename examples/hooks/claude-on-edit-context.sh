#!/usr/bin/env bash
# Claude Code PostToolUse hook: surface the linked counterpart content of the
# file that was just edited, so the agent reconciles the edit with the linked
# specification (or code) before moving on.
#
# PostToolUse, not PreToolUse: Claude Code delivers a PreToolUse hook's
# additionalContext next to the tool result (after the edit runs), so it cannot
# enforce read-before-editing. Delivering it right after the edit is the honest,
# documented behavior.
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

# Let SpecLink decide whether the file is managed: `speclink context` resolves
# the path against the project's language-keyed config and reports no context
# blocks for anything it does not manage (handled by the summary-line guard
# below). This keeps the hook language-agnostic instead of hard-coding an
# extension allowlist.
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
      hookEventName: "PostToolUse",
      additionalContext: [
        `SpecLink: linked counterpart content for ${process.env.FILE_PATH} (just edited). Reconcile the edit with it; if the change altered documented behavior, update the counterpart too:`,
        "",
        process.env.CONTEXT_OUT,
      ].join("\n"),
    },
  }));
'
