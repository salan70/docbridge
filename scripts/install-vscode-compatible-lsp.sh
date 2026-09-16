#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDITOR="${1:-code}"
BUN_PATH="$(command -v bun)"

resolve_editor_command() {
  local editor="$1"

  if command -v "$editor" >/dev/null 2>&1; then
    command -v "$editor"
    return 0
  fi

  case "$editor" in
    code)
      if [[ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
        printf '%s\n' "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
        return 0
      fi
      ;;
    cursor)
      if [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
        printf '%s\n' "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
        return 0
      fi
      ;;
  esac

  return 1
}

if ! EDITOR_CMD="$(resolve_editor_command "$EDITOR")"; then
  echo "Could not find '$EDITOR' on PATH or in the standard macOS app location." >&2
  echo "For VS Code, run 'Shell Command: Install code command in PATH' from the Command Palette." >&2
  exit 1
fi

echo "==> Configuring workspace settings"
bun run "$ROOT/scripts/configure-editor-lsp.ts" "$ROOT" "$BUN_PATH"

# Same assembly implementation as the release VSIX, in local mode: it installs
# both lockfiles, bundles the server and the client, and stages the runtime
# assets. Only the required scanner platforms differ.
echo "==> Packaging editor extension" >&2
VSIX="$(bun run "$ROOT/scripts/vscode-extension.ts" package --local)"

echo "==> Verifying the packaged extension" >&2
bun run "$ROOT/scripts/vscode-extension.ts" verify "$VSIX" --local

echo "==> Installing extension into $EDITOR"
"$EDITOR_CMD" --install-extension "$VSIX" --force

echo "==> Opening workspace with $EDITOR"
"$EDITOR_CMD" --new-window "$ROOT"
