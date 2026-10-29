#!/usr/bin/env bash
# Maintainer-only: generate, stage, and activate vNext release signing keys.
# Usage:
#   scripts/release-keygen.sh --role primary --key-id ID
#   scripts/release-keygen.sh --role backup --key-id ID --backup-out PATH
#   scripts/release-keygen.sh --activate --key-id ID
#
# Every key lives in its own slot, so generating a key never replaces the active
# one. Only `--activate` selects the active slot.
#
# primary (stage): appends `ID <public key>` to
#   crates/docbridge-update/keys/trusted-keys.txt first, then sends the private
#   seed from memory to the per-key secret DOCBRIDGE_RELEASE_SIGNING_KEY_<ID> of
#   the `release` environment through `gh secret set` on stdin. It refuses an
#   existing secret of that name and never touches the active key ID or secret.
# backup: writes the private seed to PATH (new file, mode 0600) for offline
#   storage, then appends the public entry; the seed is never uploaded.
# activate: once a published release trusts the key (or for the first key),
#   points DOCBRIDGE_RELEASE_KEY_SECRET and then DOCBRIDGE_RELEASE_KEY_ID at it.
#   Secrets are never modified or deleted, so the previous key stays usable:
#   activating its ID again rolls back.
# The private key is never printed, traced, or passed as an argument. Commit
# trusted-keys.txt in a reviewed pull request.
# Set DOCBRIDGE_RELEASE_REPO to target another repository (default salan70/docbridge).

# Never trace this script: `bash -x`, an inherited SHELLOPTS=xtrace, or
# BASH_XTRACEFD would otherwise write the seed to a log. Tracing stays off
# through cleanup, and child processes inherit SHELLOPTS without xtrace.
set +x
unset BASH_XTRACEFD
set -euo pipefail

usage() {
  echo "usage: $0 --role primary|backup --key-id ID [--backup-out PATH]" >&2
  echo "       $0 --activate --key-id ID" >&2
  exit 2
}
role=""
key_id=""
backup_out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --activate)
      [ -z "$role" ] || usage
      role=activate
      shift
      continue
      ;;
    --role)
      [ -z "$role" ] || usage
      role="${2:-}"
      [ "$role" != activate ] || usage
      ;;
    --key-id) key_id="${2:-}" ;;
    --backup-out) backup_out="${2:-}" ;;
    *) usage ;;
  esac
  shift 2 || usage
done
case "$role" in
  primary | activate) [ -z "$backup_out" ] || usage ;;
  backup) [ -n "$backup_out" ] || usage ;;
  *) usage ;;
esac
if ! [[ "$key_id" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo "key id must be 1-64 characters of [A-Za-z0-9._-]" >&2
  exit 2
fi

# DOCBRIDGE_RELEASE_SIGNING_KEY_<ID upper-cased, with . and - as _>.
secret_name() {
  printf 'DOCBRIDGE_RELEASE_SIGNING_KEY_%s' "$(printf '%s' "$1" | tr 'a-z.-' 'A-Z__')"
}
root="$(cd "$(dirname "$0")/.." && pwd)"
keys="$root/crates/docbridge-update/keys/trusted-keys.txt"
repo="${DOCBRIDGE_RELEASE_REPO:-salan70/docbridge}"
secret="$(secret_name "$key_id")"
trusted_ids="$(sed -e 's/#.*//' "$keys" | awk 'NF { print $1 }')"

# Fails closed: a failed listing is an error, never an empty list.
staged_secrets() {
  gh secret list --env release --repo "$repo" --json name --jq '.[].name'
}
if [ "$role" != backup ]; then
  command -v gh >/dev/null || {
    echo "gh is required for --role primary and --activate" >&2
    exit 1
  }
fi

if [ "$role" = activate ]; then
  if ! grep -qxF "$key_id" <<<"$trusted_ids"; then
    echo "key id $key_id is not in $keys; stage it and merge the entry first" >&2
    exit 1
  fi
  if ! names="$(staged_secrets)"; then
    echo "could not list the release environment secrets; nothing changed" >&2
    exit 1
  fi
  if ! grep -qxF "$secret" <<<"$names"; then
    echo "secret $secret is not in the release environment of $repo; nothing changed" >&2
    exit 1
  fi
  if [ -t 0 ]; then
    printf 'Make %s the active signing key of %s? Type the key id to confirm: ' "$key_id" "$repo"
    read -r answer
    [ "$answer" = "$key_id" ] || {
      echo "not confirmed; nothing changed" >&2
      exit 1
    }
  fi
  # The secret name first: if the key ID update then fails, the pair mismatches
  # and the release workflow refuses to sign until this is run again.
  gh variable set DOCBRIDGE_RELEASE_KEY_SECRET --env release --repo "$repo" --body "$secret"
  gh variable set DOCBRIDGE_RELEASE_KEY_ID --env release --repo "$repo" --body "$key_id"
  echo "Activated $key_id ($secret). The previous key's secret is unchanged."
  exit 0
fi

if grep -qxF "$key_id" <<<"$trusted_ids"; then
  echo "key id $key_id is already in $keys" >&2
  exit 1
fi
while read -r existing; do
  if [ -n "$existing" ] && [ "$(secret_name "$existing")" = "$secret" ]; then
    echo "key id $key_id maps to the same secret name as $existing; choose another id" >&2
    exit 1
  fi
done <<<"$trusted_ids"
if [ "$role" = backup ] && [ -e "$backup_out" ]; then
  echo "$backup_out already exists; refusing to overwrite a key" >&2
  exit 1
fi
if [ "$role" = primary ]; then
  if ! names="$(staged_secrets)"; then
    echo "could not list the release environment secrets; nothing changed" >&2
    exit 1
  fi
  if grep -qxF "$secret" <<<"$names"; then
    echo "secret $secret already exists in the release environment; nothing changed" >&2
    exit 1
  fi
fi

cargo build --quiet --package docbridge-release --locked \
  --manifest-path "$root/Cargo.toml" --target-dir "$root/.tmp/rust-vnext"
tool="$root/.tmp/rust-vnext/debug/docbridge-release"

umask 077
DOCBRIDGE_KEYGEN_SEED="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
export DOCBRIDGE_KEYGEN_SEED
trap 'unset DOCBRIDGE_KEYGEN_SEED' EXIT
public="$("$tool" public-key --key-env DOCBRIDGE_KEYGEN_SEED)"

if [ "$role" = backup ]; then
  (
    set -o noclobber
    printf '%s\n' "$DOCBRIDGE_KEYGEN_SEED" >"$backup_out"
  )
  unset DOCBRIDGE_KEYGEN_SEED
  printf '%s %s\n' "$key_id" "$public" >>"$keys"
  echo "Added backup key $key_id to ${keys#"$root"/}: $public"
  echo "Move $backup_out to offline storage now, then delete the local copy."
else
  # The public entry first: a failed upload then leaves only an unused entry, and
  # the active key, key ID, and secret are untouched either way.
  printf '%s %s\n' "$key_id" "$public" >>"$keys"
  if ! printf '%s' "$DOCBRIDGE_KEYGEN_SEED" \
    | gh secret set "$secret" --env release --repo "$repo"; then
    unset DOCBRIDGE_KEYGEN_SEED
    echo "storing $secret failed; the active key is unchanged." >&2
    echo "This seed is discarded: remove the $key_id line from ${keys#"$root"/} and run again." >&2
    exit 1
  fi
  unset DOCBRIDGE_KEYGEN_SEED
  echo "Staged primary key $key_id as $secret and added it to ${keys#"$root"/}: $public"
  echo "It is not active. Run --activate --key-id $key_id once a published release trusts it."
fi
echo "Commit trusted-keys.txt in a reviewed pull request; the CLI trusts it only after release."
