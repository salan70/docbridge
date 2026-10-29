#!/usr/bin/env bash
# Required pull request check (`release-label` workflow). Each pull request
# carries exactly one `release: none|patch|minor|major` label, and the crate
# versions and CHANGELOG.md in the working tree must match that label against
# the base commit. Labels record the version decision; nothing publishes on
# merge, since a maintainer dispatches Release vNext manually.
# Usage: scripts/check-release-label.sh BASE_REF [LABEL...]
set -euo pipefail

# shellcheck source=scripts/release-lib.sh
. "$(dirname "$0")/release-lib.sh"

[ "$#" -ge 1 ] || {
  echo "usage: $0 BASE_REF [LABEL...]" >&2
  exit 2
}
base_ref="$1"
shift

release_label=""
release_label_count=0
release_label_list=""
for label in "$@"; do
  case "$label" in
    "release: "*)
      release_label="$label"
      release_label_count=$((release_label_count + 1))
      release_label_list="${release_label_list:+$release_label_list, }$label"
      ;;
  esac
done
if [ "$release_label_count" -eq 0 ]; then
  echo "Add exactly one release label: release: none, release: patch, release: minor, or release: major." >&2
  exit 1
fi
if [ "$release_label_count" -gt 1 ]; then
  echo "Found $release_label_count release labels ($release_label_list); keep exactly one." >&2
  exit 1
fi
kind="${release_label#release: }"
case "$kind" in none | patch | minor | major) ;; *)
  echo "Unknown release label '$release_label'." >&2
  exit 1
  ;;
esac

# The base version comes from the crate manifest. A base that still has the
# legacy npm manifest predates the cutover (#215), and its released version is
# the npm package's.
if legacy_manifest="$(git show "$base_ref:package.json" 2>/dev/null)"; then
  base_version="$(sed -n 's/^  "version": "\(.*\)",\{0,1\}$/\1/p' <<<"$legacy_manifest" | head -n 1)"
else
  base_version="$(git show "$base_ref:crates/docbridge/Cargo.toml" | manifest_version)"
fi
[ -n "$base_version" ] || {
  echo "Cannot read the release version at $base_ref." >&2
  exit 1
}
base_unreleased="$(git show "$base_ref:CHANGELOG.md" | changelog_section "## [Unreleased]" || true)"
head_unreleased="$(changelog_section "## [Unreleased]" <CHANGELOG.md || true)"

problems=()
if [ "$kind" = none ]; then
  for manifest in $(release_manifests); do
    version="$(manifest_version <"$manifest")"
    if [ "$version" != "$base_version" ]; then
      problems+=("$manifest version must stay $base_version for release: none (found $version).")
    fi
  done
  if [ "$head_unreleased" != "$base_unreleased" ]; then
    problems+=("CHANGELOG.md [Unreleased] must stay unchanged for release: none. Use a releasing label for user-facing changes.")
  fi
  expected="$base_version"
else
  expected="$(next_version "$base_version" "$kind")"
  fix="Run \`just release-bump $kind\`."
  for manifest in $(release_manifests); do
    version="$(manifest_version <"$manifest")"
    if [ "$version" != "$expected" ]; then
      problems+=("$manifest version must be $expected for release: $kind (found $version). $fix")
    fi
  done
  if [ -z "$(changelog_section "## [$expected]" <CHANGELOG.md || true)" ]; then
    problems+=("CHANGELOG.md needs a non-empty '## [$expected]' section. $fix")
  fi
  if [ -n "$head_unreleased" ]; then
    problems+=("CHANGELOG.md [Unreleased] must be empty after the roll. $fix")
  fi
fi

if [ "${#problems[@]}" -gt 0 ]; then
  printf '%s\n' "${problems[@]}" >&2
  exit 1
fi
echo "release: $kind matches the change ($base_version -> $expected)."
