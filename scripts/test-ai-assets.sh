#!/usr/bin/env bash
# Exercise the agent gate against isolated repository layouts.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fixture="$scratch/repo"
mkdir -p "$fixture/.agents/skills"
for name in docbridge tdd git-workflow; do
  cp -R "$repo/.agents/skills/$name" "$fixture/.agents/skills/$name"
done
cp "$repo/AGENTS.md" "$fixture/AGENTS.md"
cp "$repo/CONTRIBUTING.md" "$fixture/CONTRIBUTING.md"
expect() {
  local expected="$1"
  local actual=0
  bash "$repo/scripts/check-ai-assets.sh" "$fixture" >"$scratch/output" 2>&1 || actual=$?
  if [ "$actual" -ne "$expected" ]; then
    cat "$scratch/output" >&2
    echo "Expected exit $expected, got $actual" >&2
    exit 1
  fi
}
expect 0
mv "$fixture/.agents/skills/tdd" "$scratch/tdd"
expect 1
ln -s "$scratch/tdd" "$fixture/.agents/skills/tdd"
expect 1
rm "$fixture/.agents/skills/tdd"
mv "$scratch/tdd" "$fixture/.agents/skills/tdd"
mkdir "$fixture/.agents/skills/obsolete"
expect 1
rmdir "$fixture/.agents/skills/obsolete"
mkdir -p "$fixture/.claude/skills"
ln -s ../../.agents/skills/tdd "$fixture/.claude/skills/tdd"
expect 1
rm "$fixture/.claude/skills/tdd"
rmdir "$fixture/.claude/skills"
touch "$fixture/CLAUDE.md"
expect 1
rm "$fixture/CLAUDE.md"
mv "$fixture/.agents/skills/docbridge/.docbridge-owned.json" "$scratch/owned.json"
expect 1
mv "$scratch/owned.json" "$fixture/.agents/skills/docbridge/.docbridge-owned.json"
mv "$fixture/CONTRIBUTING.md" "$scratch/contributing.md"
expect 1
mv "$scratch/contributing.md" "$fixture/CONTRIBUTING.md"
cp "$fixture/AGENTS.md" "$scratch/agents.md"
printf '# Agent rules\n' >"$fixture/AGENTS.md"
expect 1
cp "$scratch/agents.md" "$fixture/AGENTS.md"
printf '\nSee docs/contributing/testing.md\n' >>"$fixture/.agents/skills/tdd/SKILL.md"
expect 1
echo "Agent asset regression checks passed."
