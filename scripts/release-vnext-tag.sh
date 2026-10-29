#!/usr/bin/env bash
# Fail-closed checks of the vNext release tag `v<version>` on origin.
# Usage:
#   scripts/release-vnext-tag.sh check VERSION SHA
#   scripts/release-vnext-tag.sh ensure VERSION SHA
#
# check: succeeds only if the tag is absent or points exactly at SHA. A failed
#   lookup is an error, never "absent".
# ensure: like check, then creates the tag at SHA through the GitHub API when it
#   is absent and checks again that it points exactly at SHA. Publishing a draft
#   release would otherwise reuse a tag that appeared meanwhile, ignoring the
#   release's target commit. An annotated tag never matches SHA, so it fails.
# ensure needs GITHUB_REPOSITORY and an authenticated gh with contents: write.
set -euo pipefail

usage() {
  echo "usage: $0 check|ensure VERSION SHA" >&2
  exit 2
}
[ "$#" -eq 3 ] || usage
mode="$1"
version="$2"
sha="$3"
case "$mode" in
  check | ensure) ;;
  *) usage ;;
esac
if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "version must be X.Y.Z" >&2
  exit 2
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "SHA must be a full 40-character commit SHA" >&2
  exit 2
fi
tag="v${version}"
ref="refs/tags/${tag}"

# Prints the SHA the tag points at, or nothing when it is absent. `ls-remote
# --exit-code` exits 2 only when no ref matches; any other failure is fatal.
remote_tag() {
  local out status=0
  out="$(git ls-remote --exit-code --tags origin "$ref")" || status=$?
  case "$status" in
    0) awk -v ref="$ref" '$2 == ref { print $1 }' <<<"$out" ;;
    2) ;;
    *)
      echo "::error::looking up ${tag} on origin failed (git exit ${status})" >&2
      return 1
      ;;
  esac
}
# Succeeds if the tag is absent (prints nothing) or at SHA (prints SHA).
absent_or_at_sha() {
  local current
  current="$(remote_tag)" || return 1
  if [ -n "$current" ] && [ "$current" != "$sha" ]; then
    echo "::error::tag ${tag} exists at ${current}, not the release commit ${sha}" >&2
    return 1
  fi
  printf '%s' "$current"
}

current="$(absent_or_at_sha)"
if [ "$mode" = check ]; then
  echo "tag ${tag}: ${current:-absent}"
  exit 0
fi
if [ -z "$current" ]; then
  gh api -X POST "repos/${GITHUB_REPOSITORY:?}/git/refs" \
    -f "ref=${ref}" -f "sha=${sha}" >/dev/null
fi
current="$(absent_or_at_sha)"
if [ "$current" != "$sha" ]; then
  echo "::error::tag ${tag} does not point at ${sha} after creating it" >&2
  exit 1
fi
echo "tag ${tag}: ${sha}"
