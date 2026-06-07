#!/usr/bin/env bash
set -euo pipefail

read -r -d '' REMINDER <<'EOF' || true
SpecLink repo reminder:
- Use repo-native `just` commands instead of shell-specific assumptions.
- Runtime is Bun; keep dependencies minimal.
- Before completion, changed work should pass `just check` and `just test`.
- Use English for deliverables except Japanese docs under `docs/ja/`.
EOF

REMINDER="$REMINDER" bun -e '
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: process.env.REMINDER,
    },
  }));
'
