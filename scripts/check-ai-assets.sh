#!/usr/bin/env bash
# Checks the agent skill layout: every skill lives once under .agents/skills/,
# and .claude/skills/ holds a symlink that resolves to it. The exception is the
# DocBridge skill, which `docbridge init --claude` installs as a managed copy
# in both trees; the two copies must stay identical.
# Usage: scripts/check-ai-assets.sh [ROOT]
set -euo pipefail

root="${1:-.}"
codex="$root/.agents/skills"
claude="$root/.claude/skills"
managed=docbridge
errors=0

fail() {
  echo "$1" >&2
  errors=1
}

names="$(
  {
    ls -1 "$codex" 2>/dev/null || true
    ls -1 "$claude" 2>/dev/null || true
  } | sort -u
)"
for name in $names; do
  if [ ! -e "$codex/$name" ] && [ ! -L "$codex/$name" ]; then
    fail "$name is missing from .agents/skills/."
    continue
  fi
  if [ ! -e "$claude/$name" ] && [ ! -L "$claude/$name" ]; then
    fail "$name is missing from .claude/skills/."
    continue
  fi
  if [ -L "$codex/$name" ] || [ ! -d "$codex/$name" ]; then
    fail ".agents/skills/$name must be a directory, not a symlink."
    continue
  fi
  if [ "$name" = "$managed" ]; then
    if [ -L "$claude/$name" ] || [ ! -d "$claude/$name" ]; then
      fail ".claude/skills/$name must be a directory installed by docbridge init --claude."
    elif ! diff -r "$codex/$name" "$claude/$name" >/dev/null; then
      fail ".claude/skills/$name differs from .agents/skills/$name; reinstall both with docbridge init --force --claude."
    fi
    continue
  fi
  if [ ! -L "$claude/$name" ] \
    || [ "$(cd "$claude/$name" 2>/dev/null && pwd -P)" != "$(cd "$codex/$name" && pwd -P)" ]; then
    fail ".claude/skills/$name must be a symlink that resolves to .agents/skills/$name."
  fi
done
[ "$errors" -eq 0 ] || exit 1
echo "Agent skill trees are consistent."
