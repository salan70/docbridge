#!/usr/bin/env bash
# Applies a release bump inside a pull request: rolls CHANGELOG.md
# `## [Unreleased]` into `## [X.Y.Z] - <date>` and sets that version in every
# release manifest and in Cargo.lock. The pull request's `release: <kind>`
# label must name the same kind. Run from the repository root.
# Usage: scripts/release-bump.sh <patch|minor|major>
set -euo pipefail

# shellcheck source=scripts/release-lib.sh
. "$(dirname "$0")/release-lib.sh"

repository="salan70/docbridge"
kind="${1:-}"
case "$kind" in patch | minor | major) ;; *)
  echo "usage: $0 <patch|minor|major>" >&2
  exit 2
  ;;
esac

current="$(manifest_version <crates/docbridge/Cargo.toml)"
version="$(next_version "$current" "$kind")"

# Check everything before the first write, so a refused bump changes nothing.
if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md has no '## [Unreleased]' section. Add one with entries before running \`just release-bump\`." >&2
  exit 1
fi
body="$(changelog_section "## [Unreleased]" <CHANGELOG.md)"
if [ -z "$body" ]; then
  echo "'## [Unreleased]' has no entries. Document user-facing changes before running \`just release-bump\`." >&2
  exit 1
fi

today="$(date -u +%Y-%m-%d)"
base_url="https://github.com/$repository"
BODY="$body" awk -v version="$version" -v date="$today" -v base="$base_url" '
  function refs() {
    print "[Unreleased]: " base "/compare/v" version "...HEAD"
    print "[" version "]: " base "/releases/tag/v" version
    inserted = 1
  }
  state == 0 && index($0, "## [Unreleased]") == 1 {
    print "## [Unreleased]"
    print ""
    print "## [" version "] - " date
    print ""
    print ENVIRON["BODY"]
    print ""
    state = 1
    next
  }
  state == 1 {
    if (/^## \[/ || /^\[[^]]+\]:[ \t]/) state = 2
    else next
  }
  /^\[Unreleased\]:[ \t]/ { next }
  !inserted && /^\[[^]]+\]:[ \t]/ { refs() }
  { print; last = $0 }
  END {
    if (!inserted) {
      if (last != "") print ""
      refs()
    }
  }' CHANGELOG.md >CHANGELOG.md.tmp

for manifest in $(release_manifests); do
  awk -v version="$version" '
    /^\[/ { in_package = ($0 == "[package]") }
    in_package && !done && /^version = "/ { print "version = \"" version "\""; done = 1; next }
    { print }' "$manifest" >"$manifest.tmp"
done

mv CHANGELOG.md.tmp CHANGELOG.md
for manifest in $(release_manifests); do
  mv "$manifest.tmp" "$manifest"
done
cargo update --workspace --offline
echo "Bumped to $version"
