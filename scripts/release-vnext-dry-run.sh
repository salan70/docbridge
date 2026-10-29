#!/usr/bin/env bash
# Dry run of the vNext release signing, without any release or production key.
# Usage: scripts/release-vnext-dry-run.sh <docbridge-release> <artifacts-dir> <out-dir> <version>
# Signs the five target executables in <artifacts-dir> with a throwaway Ed25519
# key generated here, verifies the complete asset set through the upgrade
# verifier, and checks that tampering and the compiled (pending) production
# trust are both rejected. The throwaway key never leaves this process tree.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <docbridge-release> <artifacts-dir> <out-dir> <version>" >&2
  exit 2
fi
tool="$1"
artifacts="$2"
out="$3"
version="$4"
key_id=dry-run-throwaway

DOCBRIDGE_DRY_RUN_SIGNING_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
export DOCBRIDGE_DRY_RUN_SIGNING_KEY
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${DOCBRIDGE_DRY_RUN_SIGNING_KEY}"
fi
"$tool" sign --version "$version" --artifacts "$artifacts" --out "$out" \
  --key-id "$key_id" --key-env DOCBRIDGE_DRY_RUN_SIGNING_KEY
public="$("$tool" public-key --key-env DOCBRIDGE_DRY_RUN_SIGNING_KEY)"
unset DOCBRIDGE_DRY_RUN_SIGNING_KEY

"$tool" verify --dir "$out" --version "$version" --key-id "$key_id" --public-key "$public"

expect_rejected() {
  local what="$1"
  local reason="$2"
  shift 2
  local err
  if err="$("$@" 2>&1 >/dev/null)"; then
    echo "dry run: $what was accepted" >&2
    exit 1
  fi
  if [[ "$err" != *"$reason"* ]]; then
    echo "dry run: $what was rejected for an unexpected reason: $err" >&2
    exit 1
  fi
  echo "dry run: $what rejected as expected ($reason)"
}

# The compiled production trust is pending, so it must not accept a throwaway key.
expect_rejected "the throwaway key under compiled trust" "unknown signing key" \
  "$tool" verify --dir "$out" --version "$version" --compiled-keys

# A tampered executable with a regenerated (unsigned) SHA256SUMS.
tampered="$(mktemp -d)"
trap 'rm -rf "$tampered"' EXIT
cp "$out"/* "$tampered"/
printf 'tampered' >"$tampered/docbridge-x86_64-unknown-linux-musl"
if command -v sha256sum >/dev/null 2>&1; then
  sum=(sha256sum)
else
  sum=(shasum -a 256)
fi
sums="$(cd "$tampered" && find . -maxdepth 1 -type f ! -name SHA256SUMS -exec basename {} \; | LC_ALL=C sort | xargs "${sum[@]}")"
printf '%s\n' "$sums" >"$tampered/SHA256SUMS"
expect_rejected "a tampered executable" "checksum mismatch" \
  "$tool" verify --dir "$tampered" --version "$version" --key-id "$key_id" --public-key "$public"
