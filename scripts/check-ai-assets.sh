#!/usr/bin/env bash
# Check the single canonical agent skill tree and contributor references.
# Usage: scripts/check-ai-assets.sh [ROOT]
set -euo pipefail

root="${1:-.}"
skills="$root/.agents/skills"
errors=0
fail() {
  echo "$1" >&2
  errors=1
}

for name in docbridge tdd git-workflow; do
  if [ -L "$skills/$name" ] || [ ! -d "$skills/$name" ] || [ ! -s "$skills/$name/SKILL.md" ]; then
    fail ".agents/skills/$name must be a canonical directory containing SKILL.md."
  fi
done
for path in "$skills"/* "$skills"/.[!.]* "$skills"/..?*; do
  [ -e "$path" ] || [ -L "$path" ] || continue
  case "${path##*/}" in
    docbridge | tdd | git-workflow) ;;
    *) fail "Unexpected canonical skill: ${path##*/}" ;;
  esac
done
if [ ! -s "$skills/docbridge/.docbridge-owned.json" ]; then
  fail "The managed DocBridge skill requires its ownership metadata."
fi
if [ -e "$root/.claude/skills" ] || [ -L "$root/.claude/skills" ]; then
  fail "Duplicate .claude/skills assets must be removed."
fi
if [ -e "$root/CLAUDE.md" ] || [ -L "$root/CLAUDE.md" ]; then
  fail "CLAUDE.md must be removed; AGENTS.md owns shared agent rules."
fi
for anchor in verification git-and-pull-requests documentation; do
  if ! grep -Fq "CONTRIBUTING.md#$anchor" "$root/AGENTS.md"; then
    fail "AGENTS.md must reference CONTRIBUTING.md#$anchor."
  fi
done
if [ ! -s "$root/CONTRIBUTING.md" ]; then
  fail "CONTRIBUTING.md must provide the canonical contributor workflow."
fi
for name in tdd git-workflow; do
  if ! grep -Fq 'CONTRIBUTING.md#' "$skills/$name/SKILL.md"; then
    fail "$name must reference the canonical contributor workflow."
  fi
done
if grep -En 'docs/contributing/(commits|pull-requests|testing|writing|documentation|self-audit)\.md|concise-writing|grill-me|pr-review|review-response' \
  "$root/AGENTS.md" "$skills/tdd/SKILL.md" "$skills/git-workflow/SKILL.md"; then
  fail "Agent rules reference retired contributor assets."
fi
[ "$errors" -eq 0 ] || exit 1
echo "Canonical agent assets are consistent."
