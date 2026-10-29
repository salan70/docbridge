#!/usr/bin/env bash
# Exercise the agent gate against isolated repository layouts.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fixture="$scratch/repo"
mkdir -p "$fixture/.agents/skills"
for name in docbridge git-workflow; do
  cp -R "$repo/.agents/skills/$name" "$fixture/.agents/skills/$name"
done
cp "$repo/AGENTS.md" "$fixture/AGENTS.md"
mkdir -p "$fixture/docs" "$fixture/.claude"
cp "$repo/docs/CONTRIBUTING.md" "$fixture/docs/CONTRIBUTING.md"
ln -s ../.agents/skills "$fixture/.claude/skills"
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
mv "$fixture/.agents/skills/git-workflow" "$scratch/git-workflow"
expect 1
ln -s "$scratch/git-workflow" "$fixture/.agents/skills/git-workflow"
expect 1
rm "$fixture/.agents/skills/git-workflow"
mv "$scratch/git-workflow" "$fixture/.agents/skills/git-workflow"
mkdir "$fixture/.agents/skills/obsolete"
expect 1
rmdir "$fixture/.agents/skills/obsolete"
rm "$fixture/.claude/skills"
expect 1
printf '../.agents/skills\n' >"$fixture/.claude/skills"
expect 1
rm "$fixture/.claude/skills"
cp -R "$fixture/.agents/skills" "$fixture/.claude/skills"
expect 1
rm -r "$fixture/.claude/skills"
for target in "$fixture/.agents/skills" ../.agents/skills/ ../outside ../../outside; do
  ln -s "$target" "$fixture/.claude/skills"
  expect 1
  rm "$fixture/.claude/skills"
done
ln -s ../.agents/skills "$fixture/.claude/skills"
expect 0
touch "$fixture/CLAUDE.md"
expect 1
rm "$fixture/CLAUDE.md"
mv "$fixture/.agents/skills/docbridge/.docbridge-owned.json" "$scratch/owned.json"
expect 1
mv "$scratch/owned.json" "$fixture/.agents/skills/docbridge/.docbridge-owned.json"
mv "$fixture/docs/CONTRIBUTING.md" "$scratch/contributing.md"
expect 1
mv "$scratch/contributing.md" "$fixture/docs/CONTRIBUTING.md"
cp "$fixture/AGENTS.md" "$scratch/agents.md"
printf '# Agent rules\n' >"$fixture/AGENTS.md"
expect 1
cp "$scratch/agents.md" "$fixture/AGENTS.md"
printf '\nSee docs/contributing/testing.md\n' >>"$fixture/.agents/skills/git-workflow/SKILL.md"
expect 1
echo "Agent asset regression checks passed."
