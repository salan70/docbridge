#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"
stop_hook_active="$(
  PAYLOAD="$payload" bun -e '
    try {
      const input = process.env.PAYLOAD || "{}";
      const payload = JSON.parse(input);
      console.log(payload.stop_hook_active ? "true" : "false");
    } catch {
      console.log("false");
    }
  '
)"

if [[ "$stop_hook_active" == "true" ]]; then
  bun -e '
    console.log(JSON.stringify({
      systemMessage: "SpecLink Stop hook skipped automatic verification because this turn is already a Stop-hook continuation. Include any unresolved verification failures in the final report."
    }));
  '
  exit 0
fi

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

if [[ -z "$(git status --porcelain)" ]]; then
  exit 0
fi

run_just() {
  if command -v just >/dev/null 2>&1; then
    just "$@"
  else
    nix develop -c just "$@"
  fi
}

log_file="$(mktemp)"
status=0

{
  echo "$ just check"
  run_just check
  echo
  echo "$ just test"
  run_just test
} >"$log_file" 2>&1 || status=$?

if [[ "$status" -eq 0 ]]; then
  rm -f "$log_file"
  exit 0
fi

LOG_FILE="$log_file" bun -e '
  const log = await Bun.file(process.env.LOG_FILE).text();
  const tail = log.split("\n").slice(-160).join("\n");
  console.log(JSON.stringify({
    decision: "block",
    reason: [
      "SpecLink Stop hook found failing final checks.",
      "",
      tail,
      "",
      "Read the failure, fix it if it is caused by this change, then rerun `just check` and `just test` before the final response. If the failure cannot be fixed in this turn, report it explicitly."
    ].join("\n")
  }));
'

rm -f "$log_file"
