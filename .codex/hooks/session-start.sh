#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
DocBridge repo reminder:
- Use repo-native `just` commands instead of shell-specific assumptions.
- Runtime is Bun; keep dependencies minimal.
- Before completion, changed work should pass `just check` and `just test`.
- Use English for deliverables except Japanese docs under `docs/ja/`.
EOF
