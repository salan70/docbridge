#!/usr/bin/env bash
# Smoke-run a built vNext `docbridge` binary in a throwaway project.
# Usage: scripts/smoke-vnext.sh <path-to-docbridge-binary>
# The binary must start, show the offline docs, and handle a representative
# validate / links / unlinked flow with no language runtime.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path-to-docbridge-binary>" >&2
  exit 2
fi

bin="$1"
if [ ! -x "$bin" ] && [ -x "$bin.exe" ]; then
  bin="$bin.exe"
fi
bin="$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

expect_exit() {
  local want="$1"
  shift
  local got=0
  "$@" >"$work/out" 2>"$work/err" || got=$?
  if [ "$got" -ne "$want" ]; then
    echo "expected exit $want, got $got: $*" >&2
    cat "$work/out" "$work/err" >&2
    exit 1
  fi
}

expect_exit 0 "$bin" --help
expect_exit 0 "$bin" docs list
grep -q getting-started "$work/out"
expect_exit 3 "$bin" docs show no-such-guide

project="$work/project"
mkdir -p "$project/src" "$project/docs"
cat >"$project/docbridge.config.json" <<'JSON'
{
  "include": {
    "code": { "paths": ["src"], "extensions": [".rs"] },
    "docs": ["docs"]
  }
}
JSON
printf 'fn main() {}\n' >"$project/src/main.rs"
printf 'pub fn unused() {}\n' >"$project/src/extra.rs"
cat >"$project/docs/design.md" <<'MD'
# Design

<!-- @code src/main.rs -->
## Entry point

The program starts here.

## Notes

Not linked yet.
MD

expect_exit 0 "$bin" validate --root "$project"
expect_exit 0 "$bin" links --root "$project" --json
grep -q '"edges"' "$work/out"
expect_exit 0 "$bin" links --root "$project" --include-content docs/design.md
grep -q 'The program starts here.' "$work/out"
expect_exit 0 "$bin" unlinked --root "$project"
grep -q 'src/extra.rs' "$work/out"

printf '<!-- @code src/missing.rs -->\n## Broken\n' >>"$project/docs/design.md"
expect_exit 1 "$bin" validate --root "$project"

# Without a standalone install receipt (or under a package manager) upgrade must refuse self-replacement offline.
expect_exit 1 "$bin" upgrade --check
grep -Eq 'install provenance|managed installation' "$work/err"

echo "vNext smoke checks passed: $bin"
