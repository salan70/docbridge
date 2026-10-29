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

if [ -L "$skills" ] || [ ! -d "$skills" ]; then
  fail ".agents/skills must be a physical canonical directory."
fi
for name in docbridge git-workflow; do
  if [ -L "$skills/$name" ] || [ ! -d "$skills/$name" ] || [ ! -s "$skills/$name/SKILL.md" ]; then
    fail ".agents/skills/$name must be a canonical directory containing SKILL.md."
  fi
done
for path in "$skills"/* "$skills"/.[!.]* "$skills"/..?*; do
  [ -e "$path" ] || [ -L "$path" ] || continue
  case "${path##*/}" in
    docbridge | git-workflow) ;;
    *) fail "Unexpected canonical skill: ${path##*/}" ;;
  esac
done
if [ ! -s "$skills/docbridge/.docbridge-owned.json" ]; then
  fail "The managed DocBridge skill requires its ownership metadata."
fi
if [ ! -L "$root/.claude/skills" ] || [ "$(readlink "$root/.claude/skills")" != '../.agents/skills' ]; then
  fail ".claude/skills must be the exact symlink ../.agents/skills (enable Git symlink checkout; do not copy)."
fi
if [ -e "$root/CLAUDE.md" ] || [ -L "$root/CLAUDE.md" ]; then
  fail "CLAUDE.md must be removed; AGENTS.md owns shared agent rules."
fi
for anchor in verification git-and-pull-requests documentation; do
  if ! grep -Fq "docs/CONTRIBUTING.md#$anchor" "$root/AGENTS.md"; then
    fail "AGENTS.md must reference docs/CONTRIBUTING.md#$anchor."
  fi
done
if [ ! -s "$root/docs/CONTRIBUTING.md" ]; then
  fail "docs/CONTRIBUTING.md must provide the canonical contributor workflow."
fi
if ! grep -Fq 'docs/CONTRIBUTING.md#' "$skills/git-workflow/SKILL.md"; then
  fail "git-workflow must reference the canonical contributor workflow."
fi
if grep -En 'docs/contributing/(commits|pull-requests|testing|writing|documentation|self-audit)\.md|concise-writing|grill-me|pr-review|review-response' \
  "$root/AGENTS.md" "$skills/git-workflow/SKILL.md"; then
  fail "Agent rules reference retired contributor assets."
fi
[ "$errors" -eq 0 ] || exit 1
echo "Canonical agent assets are consistent."
