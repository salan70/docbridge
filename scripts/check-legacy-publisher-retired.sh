#!/usr/bin/env bash
# Gate for a production vNext release: fails while any workflow other than
# release-vnext.yml can publish a GitHub release or an npm package. The legacy
# npm publisher (release-publish.yml) also creates `vX.Y.Z` GitHub releases and
# marks them latest, so it could take a vNext version or the "latest" release the
# updater queries. Retire it (#215) before the first vNext release.
# Usage: scripts/check-legacy-publisher-retired.sh WORKFLOWS_DIR
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: $0 WORKFLOWS_DIR" >&2
  exit 2
}
dir="$1"
[ -d "$dir" ] || {
  echo "::error::$dir is not a directory" >&2
  exit 1
}
pattern='npm[[:space:]]+publish|gh[[:space:]]+release[[:space:]]+(create|upload|edit)|action-gh-release|/releases([^/a-z_-]|$)'
blocked=0
for file in "$dir"/*.yml "$dir"/*.yaml; do
  [ -e "$file" ] || continue
  [ "$(basename "$file")" = release-vnext.yml ] && continue
  if grep -Eq "$pattern" "$file"; then
    echo "::error::$(basename "$file") still publishes releases or packages; retire it before a vNext release (see docs/contributing/releasing.md#cutover-order)" >&2
    blocked=1
  fi
done
[ "$blocked" -eq 0 ] || exit 1
echo "No other workflow publishes releases or packages."
