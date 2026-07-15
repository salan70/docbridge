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
# in this directory. Requires bash, git, bun, and the DocBridge CLI.
set -euo pipefail

payload="$(cat || true)"

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

# How to invoke DocBridge. Override with e.g.
#   DOCBRIDGE_CMD="bun run /path/to/docbridge/src/cli/index.ts"
# Split the override into an argv array without pathname expansion.
read -r -a docbridge_cmd <<<"${DOCBRIDGE_CMD:-docbridge}"

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

# Let DocBridge decide whether the file is managed: `docbridge context` resolves
# the path against the project's language-keyed config and reports no context
# blocks for anything it does not manage (handled by the summary-line guard
# below). This keeps the hook language-agnostic instead of hard-coding an
# extension allowlist.
context_out="$("${docbridge_cmd[@]}" context "$file_path" 2>/dev/null || true)"

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
        "DocBridge: linked counterpart content for " + process.env.FILE_PATH + " (just edited). Reconcile the edit with it; if the change altered documented behavior, update the counterpart too:",
        "",
        process.env.CONTEXT_OUT,
      ].join("\n"),
    },
  }));
'
