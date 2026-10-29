#!/usr/bin/env bash
# Maintainer-only: generate a production vNext release signing key locally.
# Usage:
#   scripts/release-keygen.sh --role primary --key-id ID
#   scripts/release-keygen.sh --role backup --key-id ID --backup-out PATH
#
# primary: the private seed goes straight from memory to the
#   DOCBRIDGE_RELEASE_SIGNING_KEY secret of the `release` environment through
#   `gh secret set` on stdin, and DOCBRIDGE_RELEASE_KEY_ID is set to ID.
# backup: the private seed is written to PATH (new file, mode 0600) for offline
#   storage; it is never uploaded.
# In both roles the private key is never printed or passed as an argument. Only
# `ID <public key>` is appended to crates/docbridge-update/keys/trusted-keys.txt,
# which is then reviewed and merged in a pull request.
# Set DOCBRIDGE_RELEASE_REPO to target another repository (default salan70/docbridge).
set -euo pipefail

usage() {
  echo "usage: $0 --role primary|backup --key-id ID [--backup-out PATH]" >&2
  exit 2
}
role=""
key_id=""
backup_out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --role) role="${2:-}" ;;
    --key-id) key_id="${2:-}" ;;
    --backup-out) backup_out="${2:-}" ;;
    *) usage ;;
  esac
  shift 2 || usage
done
case "$role" in
  primary) [ -z "$backup_out" ] || usage ;;
  backup) [ -n "$backup_out" ] || usage ;;
  *) usage ;;
esac
if ! [[ "$key_id" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo "key id must be 1-64 characters of [A-Za-z0-9._-]" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
keys="$root/crates/docbridge-update/keys/trusted-keys.txt"
repo="${DOCBRIDGE_RELEASE_REPO:-salan70/docbridge}"
if grep -Eq "^${key_id//./\\.}[[:space:]]" "$keys"; then
  echo "key id $key_id is already in $keys" >&2
  exit 1
fi
if [ "$role" = backup ] && [ -e "$backup_out" ]; then
  echo "$backup_out already exists; refusing to overwrite a key" >&2
  exit 1
fi
if [ "$role" = primary ]; then
  command -v gh >/dev/null || {
    echo "gh is required for the primary key" >&2
    exit 1
  }
fi

cargo build --quiet --package docbridge-release --locked \
  --manifest-path "$root/Cargo.toml" --target-dir "$root/.tmp/rust-vnext"
tool="$root/.tmp/rust-vnext/debug/docbridge-release"

umask 077
DOCBRIDGE_KEYGEN_SEED="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
export DOCBRIDGE_KEYGEN_SEED
trap 'unset DOCBRIDGE_KEYGEN_SEED' EXIT
public="$("$tool" public-key --key-env DOCBRIDGE_KEYGEN_SEED)"

if [ "$role" = primary ]; then
  if [ -t 0 ]; then
    printf 'Replace DOCBRIDGE_RELEASE_SIGNING_KEY in the release environment of %s? Type the key id to confirm: ' "$repo"
    read -r answer
    [ "$answer" = "$key_id" ] || {
      echo "not confirmed; nothing changed" >&2
      exit 1
    }
  fi
  printf '%s' "$DOCBRIDGE_KEYGEN_SEED" \
    | gh secret set DOCBRIDGE_RELEASE_SIGNING_KEY --env release --repo "$repo"
  gh variable set DOCBRIDGE_RELEASE_KEY_ID --env release --repo "$repo" --body "$key_id"
else
  (
    set -o noclobber
    printf '%s\n' "$DOCBRIDGE_KEYGEN_SEED" >"$backup_out"
  )
fi
unset DOCBRIDGE_KEYGEN_SEED

printf '%s %s\n' "$key_id" "$public" >>"$keys"
echo "Added $role key $key_id to ${keys#"$root"/}: $public"
if [ "$role" = backup ]; then
  echo "Move $backup_out to offline storage now, then delete the local copy."
fi
echo "Commit trusted-keys.txt in a reviewed pull request; the CLI trusts it only after release."
