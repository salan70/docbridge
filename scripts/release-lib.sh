# shellcheck shell=bash
# Helpers shared by scripts/check-release-label.sh and scripts/release-bump.sh.
# Sourced, not executed. Written for bash 3.2 so it also runs on stock macOS.

# Prints every manifest whose version is part of one release, one per line.
# They move together.
release_manifests() {
  printf '%s\n' \
    crates/docbridge/Cargo.toml \
    crates/docbridge-update/Cargo.toml \
    crates/docbridge-release/Cargo.toml
}

# Prints the `[package]` version of the Cargo manifest on stdin.
manifest_version() {
  awk '
    /^\[/ { in_package = ($0 == "[package]") }
    in_package && /^version = "/ {
      value = $0
      sub(/^version = "/, "", value)
      sub(/".*/, "", value)
      print value
      exit
    }'
}

# Prints the version after $1 for the release kind $2 (patch, minor, or major).
next_version() {
  local pattern='^([0-9]+)\.([0-9]+)\.([0-9]+)$'
  if ! [[ "$1" =~ $pattern ]]; then
    echo "$1 is not a X.Y.Z semantic version" >&2
    return 1
  fi
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  case "$2" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)
      echo "unknown release kind '$2'" >&2
      return 1
      ;;
  esac
}

# Prints the trimmed body of the CHANGELOG (stdin) section under the first line
# that starts with $1. The body ends at the next version heading, the link
# references, or the end. Exits 1 when no such heading exists.
changelog_section() {
  awk -v heading="$1" '
    !found && index($0, heading) == 1 { found = 1; next }
    found && (/^## \[/ || /^\[[^]]+\]:[ \t]/) { exit }
    found { body[n++] = $0 }
    END {
      if (!found) exit 1
      first = 0
      while (first < n && body[first] ~ /^[ \t]*$/) first++
      last = n - 1
      while (last >= first && body[last] ~ /^[ \t]*$/) last--
      for (i = first; i <= last; i++) print body[i]
    }'
}
