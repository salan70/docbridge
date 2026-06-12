#!/usr/bin/env bash
# Claude Code Stop hook: report linked counterparts of uncommitted changes
# that were not themselves changed, together with their content, so the agent
# either updates each counterpart or justifies leaving it unchanged.
#
# The message is informational and never blocks the turn; put the enforcement
# point in CI or code review. Wire it as a Stop hook in .claude/settings.json;
# see the README in this directory. Requires bash, git, bun, and the SpecLink
# CLI.
set -euo pipefail

# The Stop payload is not needed: this hook never blocks, so it does not need
# stop_hook_active loop protection.
cat >/dev/null || true

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

# How to invoke SpecLink. Override with e.g.
#   SPECLINK_CMD="bun run /path/to/spec-link/src/cli/index.ts"
# Intentionally unquoted below so a multi-word command splits into words.
speclink_cmd=(${SPECLINK_CMD:-speclink})

changed_files="$({ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)"
if [[ -z "$changed_files" ]]; then
  exit 0
fi

violations_log="$(mktemp)"
context_log="$(mktemp)"
trap 'rm -f "$violations_log" "$context_log"' EXIT

printf '%s\n' "$changed_files" |
  "${speclink_cmd[@]}" related --stdin --gate --json >"$violations_log" 2>/dev/null || true
printf '%s\n' "$changed_files" |
  "${speclink_cmd[@]}" context --stdin --json >"$context_log" 2>/dev/null || true

VIOLATIONS_LOG="$violations_log" CONTEXT_LOG="$context_log" bun -e '
  const parse = async (path) => {
    try {
      return JSON.parse(await Bun.file(path).text());
    } catch {
      return null;
    }
  };
  const violations = (await parse(process.env.VIOLATIONS_LOG))?.violations ?? [];
  if (violations.length === 0) {
    process.exit(0);
  }
  const lines = violations.map(
    (v) => `${v.changedEndpoint} -> ${v.counterpartEndpoint} (counterpart not in change set)`,
  );
  const contexts = (await parse(process.env.CONTEXT_LOG))?.contexts ?? [];
  const flagged = new Set(violations.map((v) => v.counterpartEndpoint));
  const blocks = contexts.filter((c) => flagged.has(c.endpoint)).map((c) => {
    const header = `${c.endpoint} (linked from ${c.linkedFrom.join(", ")})`;
    if (c.kind !== "code") {
      return `${header}\n\n${c.content}`;
    }
    const longestRun = Math.max(2, ...(c.content.match(/`+/g) ?? []).map((r) => r.length));
    const fence = "`".repeat(longestRun + 1);
    return `${header}\n\n${fence}ts\n${c.content}\n${fence}`;
  });
  const parts = [
    [
      "SpecLink related-gate: uncommitted changes have linked counterparts that are not in the change set.",
      "",
      lines.join("\n"),
      "",
      "Update each listed counterpart or state in the final response why it needs no update. This message is informational and does not block.",
    ].join("\n"),
  ];
  if (blocks.length > 0) {
    parts.push(
      ["Flagged counterpart content (via `speclink context`):", "", blocks.join("\n\n---\n\n")].join("\n"),
    );
  }
  console.log(JSON.stringify({ systemMessage: parts.join("\n\n") }));
'
