#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDITOR_DIR="$ROOT/editors/vscode"
EDITOR="${1:-cursor}"
BUN_PATH="$(command -v bun)"

if ! command -v "$EDITOR" >/dev/null 2>&1; then
  echo "Could not find '$EDITOR' on PATH." >&2
  exit 1
fi

echo "==> Installing editor client dependencies"
(cd "$EDITOR_DIR" && bun install --frozen-lockfile)

echo "==> Compiling editor client"
(cd "$EDITOR_DIR" && bun run compile)

echo "==> Configuring workspace settings"
bun run "$ROOT/scripts/configure-editor-lsp.ts" "$ROOT" "$BUN_PATH"

echo "==> Packaging editor extension"
VSIX="$("$ROOT/scripts/package-editor-vsix.sh")"

echo "==> Installing extension into $EDITOR"
"$EDITOR" --install-extension "$VSIX" --force

echo "==> Opening workspace with $EDITOR"
"$EDITOR" --new-window "$ROOT"
