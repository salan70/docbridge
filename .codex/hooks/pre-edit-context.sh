#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# bun handles all JSON parsing and serialization; fall back to the dev shell
# so a missing PATH entry cannot silently kill the hook.
run_bun() {
  if command -v bun >/dev/null 2>&1; then
    bun "$@"
  else
    nix develop -c bun "$@"
  fi
}

file_path="$(
  PAYLOAD="$payload" run_bun -e '
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

context_out="$(run_bun run src/cli/index.ts context "$file_path" 2>/dev/null || true)"

# The summary line is always printed last (see docs/specs/cli.md); a zero
# count means the file has no linked counterparts and nothing to inject.
summary_line="$(printf '%s\n' "$context_out" | tail -n 1)"
case "$summary_line" in
  *", 0 context blocks") exit 0 ;;
  "") exit 0 ;;
esac

FILE_PATH="$file_path" CONTEXT_OUT="$context_out" run_bun -e '
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
