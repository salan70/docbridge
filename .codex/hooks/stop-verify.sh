#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_just() {
  if command -v just >/dev/null 2>&1; then
    just "$@"
  else
    nix develop -c just "$@"
  fi
}

# bun handles all JSON parsing and serialization; fall back to the dev shell
# like run_just so a missing PATH entry cannot silently kill the hook.
run_bun() {
  if command -v bun >/dev/null 2>&1; then
    bun "$@"
  else
    nix develop -c bun "$@"
  fi
}

stop_hook_active="$(
  PAYLOAD="$payload" run_bun -e '
    try {
      const input = process.env.PAYLOAD || "{}";
      const payload = JSON.parse(input);
      console.log(payload.stop_hook_active ? "true" : "false");
    } catch {
      console.log("false");
    }
  '
)"

# Nothing to verify when the worktree is clean: committed work already passed
# the pre-commit guard, and the full branch change set is gated again by the
# related-gate report job in CI.
if [[ -z "$(git status --porcelain)" ]]; then
  exit 0
fi

log_file="$(mktemp)"
status=0

run_final_check() {
  local name="$1"

  echo "$ just $name"
  run_just "$name" || return $?
}

{
  run_final_check check || status=$?
  echo
  run_final_check typecheck || status=$?
  echo
  run_final_check test || status=$?
} >"$log_file" 2>&1

if [[ "$status" -ne 0 ]]; then
  if [[ "$stop_hook_active" == "true" ]]; then
    # This turn already continued once because of a Stop-hook block. Never
    # block again (no loops), but report the measured result so the final
    # response cannot rely on self-reporting.
    LOG_FILE="$log_file" run_bun -e '
      const log = await Bun.file(process.env.LOG_FILE).text();
      const tail = log.split("\n").slice(-160).join("\n");
      console.log(JSON.stringify({
        systemMessage: [
          "DocBridge Stop hook: `just check` / `just typecheck` / `just test` are STILL FAILING on this continuation turn.",
          "",
          tail,
          "",
          "State this failure explicitly in the final response."
        ].join("\n")
      }));
    '
  else
    LOG_FILE="$log_file" run_bun -e '
      const log = await Bun.file(process.env.LOG_FILE).text();
      const tail = log.split("\n").slice(-160).join("\n");
      console.log(JSON.stringify({
        decision: "block",
        reason: [
          "DocBridge Stop hook found failing final checks.",
          "",
          tail,
          "",
          "Read the failure, fix it if it is caused by this change, then rerun `just check`, `just typecheck`, and `just test` before the final response. If the failure cannot be fixed in this turn, report it explicitly."
        ].join("\n")
      }));
    '
  fi
  rm -f "$log_file"
  exit 0
fi
rm -f "$log_file"

pass_note=""
if [[ "$stop_hook_active" == "true" ]]; then
  pass_note="DocBridge Stop hook: \`just check\`, \`just typecheck\`, and \`just test\` passed on this continuation turn."
fi

gate_log="$(mktemp)"
gate_status=0
run_just related-gate >"$gate_log" 2>&1 || gate_status=$?

if [[ "$gate_status" -eq 0 && -z "$pass_note" ]]; then
  rm -f "$gate_log"
  exit 0
fi

# When the gate flags counterparts, fetch their content so the triage judgment
# (update the counterpart, or justify leaving it) can be made without extra
# file discovery. Both commands are best-effort; an empty file just drops the
# content section from the message.
violations_log="$(mktemp)"
context_log="$(mktemp)"
if [[ "$gate_status" -ne 0 ]]; then
  changed_files="$({ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)"
  printf '%s\n' "$changed_files" |
    run_bun run src/cli/index.ts related --stdin --gate --json >"$violations_log" 2>/dev/null || true
  printf '%s\n' "$changed_files" |
    run_bun run src/cli/index.ts context --stdin --json >"$context_log" 2>/dev/null || true
fi

# The related-gate result is informational, never blocking: judgment about
# counterparts belongs to the pull request, where CI re-runs the gate over the
# whole branch change set and a human approves the merge. It is returned as Stop
# `additionalContext` (injected into the agent's context for it to act on), not
# `systemMessage` (a user-facing warning the model never sees); the turn still
# continues without blocking.
GATE_LOG="$gate_log" GATE_STATUS="$gate_status" PASS_NOTE="$pass_note" \
  VIOLATIONS_LOG="$violations_log" CONTEXT_LOG="$context_log" run_bun -e '
  const parts = [];
  if (process.env.PASS_NOTE) {
    parts.push(process.env.PASS_NOTE);
  }
  if (process.env.GATE_STATUS !== "0") {
    const log = await Bun.file(process.env.GATE_LOG).text();
    const tail = log.split("\n").slice(-80).join("\n");
    parts.push([
      "DocBridge related-gate: uncommitted changes have linked counterparts that are not in the change set.",
      "",
      tail,
      "",
      "Update each listed counterpart or state in the final response why it needs no update. This is informational and does not block; CI re-checks the whole branch on the pull request."
    ].join("\n"));
    const parse = async (path) => {
      try {
        return JSON.parse(await Bun.file(path).text());
      } catch {
        return null;
      }
    };
    const violations = (await parse(process.env.VIOLATIONS_LOG))?.violations ?? [];
    const contexts = (await parse(process.env.CONTEXT_LOG))?.contexts ?? [];
    const flagged = new Set(violations.map((v) => v.counterpartEndpoint));
    const blocks = contexts.filter((c) => flagged.has(c.endpoint)).map((c) => {
      const header = `${c.endpoint} (linked from ${c.linkedFrom.join(", ")})`;
      if (c.kind !== "code") {
        return `${header}\n\n${c.content}`;
      }
      const longestRun = Math.max(2, ...(c.content.match(/`+/g) ?? []).map((r) => r.length));
      const fence = "`".repeat(longestRun + 1);
      return `${header}\n\n${fence}ts\n${c.content}\n${fence}`;
    });
    if (blocks.length > 0) {
      parts.push([
        "Flagged counterpart content (via `docbridge context`):",
        "",
        blocks.join("\n\n---\n\n")
      ].join("\n"));
    }
  }
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: parts.join("\n\n"),
    },
  }));
'

rm -f "$gate_log" "$violations_log" "$context_log"
