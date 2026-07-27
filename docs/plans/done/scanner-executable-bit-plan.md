# Scanner Executable Bit Recovery Plan

This plan addresses [issue #74](https://github.com/salan70/docbridge/issues/74):
bundled Swift and Dart scanner binaries lose their executable bit after
installation, so `docbridge check` fails on any project that scans Swift or
Dart, and every downstream adopter ships its own `chmod +x` workaround.

The staging path already sets the bit at pack time
(`scripts/stage-scanner-binaries.ts` does `chmodSync(destination, mode | 0o755)`),
which is necessary but not sufficient: the bit is lost again on the consumer
side at install time. DocBridge must therefore recover at run time rather than
rely on the mode surviving the trip through the registry and the installer.

Normative behavior is reflected in:

- [Scanning](../../specs/scanning.md)
- [Diagnostics](../../specs/diagnostics.md)

## Status

- [x] Slice 1: Executability Probe and Repair at Resolution
- [x] Slice 2: Exec-Denied Classification and Remediation Text
- [x] Slice 3: Packed-Package Regression Coverage
- [x] Slice 4: Specification and Release Documentation

## Goals

- `docbridge check` succeeds on Swift and Dart projects without the caller
  running `chmod` on anything inside `node_modules` or the `bunx` cache.
- When DocBridge finds one of its own bundled scanner binaries non-executable,
  it restores the executable bit itself and proceeds.
- When restoring is impossible, `code_scanner_unavailable` names the actual
  cause and a concrete remedy instead of surfacing a bare spawn error.
- Regression coverage installs the packed package the way the affected
  consumers do, not only the way that already works.

## Non-Goals

- Copying scanner binaries into a writable cache directory to escape a
  `noexec` mount. See [Rejected: Writable Cache Fallback](#rejected-writable-cache-fallback).
- A `postinstall` lifecycle script. See
  [Rejected: Install-Time Repair](#rejected-install-time-repair).
- Renaming the `docbridge-swift-scanner` / `docbridge_dart_scanner` executables.
  Tracked separately in issue #75; this plan must not change those names, so
  the fix stays independently backportable.
- Changing scanner resolution order, supported platform keys, or the worker
  protocol.
- Updating the downstream repositories that carry the `chmod +x` workaround.
  Those become removable once a release ships; tracked as follow-up.

## Decisions

### Repair at Resolution, Not After a Failed Spawn

`resolveScannerWorkerCommand` in `src/core/code-language.ts` already probes each
candidate path with `existsSync`. The repair belongs there: when the selected
candidate exists but this process cannot execute it, attempt
`chmodSync(path, mode | 0o111)` and use the path when that succeeds.

The issue text describes "restore the bit and retry once", which implies
repairing after a spawn failure. Resolution-time repair is preferred because:

- It is one code path with one outcome, instead of spawn → interpret error →
  mutate → spawn again, which duplicates error interpretation across two layers.
- `spawnSync` failure modes for a non-executable file are not uniform across
  Node.js and Bun, so keying repair off the error is less reliable than keying
  it off the mode.
- It is unit-testable against a temp directory with a `0o644` file, with no
  process spawn involved.

A spawn-time path is still required for the case the mode cannot explain
(`noexec`); Slice 2 covers it.

### Repair Scope Is DocBridge-Owned Artifacts Only

Every path `scannerExecutableCandidates` can return is a DocBridge build output
or a DocBridge-packaged binary — under `packages/*/` in a source checkout or
under `dist/bin/<platform>/` in an install. Repair applies to the candidate the
resolver itself selected and to nothing else. DocBridge never chmods a path
derived from user configuration.

### Repair Is Best-Effort and Never Throws

`chmodSync` fails on a read-only store (Nix, a read-only container layer, a
locked registry cache). A failed repair must not abort the check; it degrades to
`code_scanner_unavailable` for that language, which the resolver already returns
as a diagnostic rather than an exception.

### Three Distinguishable Failure Modes

`code_scanner_unavailable` currently carries a bare reason. After this plan it
distinguishes:

1. **Missing** — no candidate exists, or the platform is unsupported. Existing
   messages, unchanged.
2. **Not executable and unrepairable** — the binary exists, this process cannot
   execute it, and `chmodSync` failed. The message names the path, the observed mode,
   and the chmod error, and states the remedy (`chmod +x <path>`, or reinstall
   into a writable location).
3. **Exec denied** — the binary exists and is executable, but the spawn is
   refused with `EACCES`/`EPERM`. The dominant cause is a `noexec` mount, which
   on macOS is where `bunx` caches packages (`/private/tmp`). The message says
   so and states the remedy: install DocBridge as a project dependency, or point
   the installer cache at an exec-capable directory, instead of running through
   `bunx`.

### Rejected: Install-Time Repair

A `postinstall` script that chmods `dist/bin/**` looks like the direct fix but
does not reach the affected consumers. `bun install` does not run lifecycle
scripts for dependencies outside `trustedDependencies`, so the script would be
skipped by the exact installer that drops the bit, and `bunx` invocation does
not go through a project's install at all. Requiring every consumer to add
`docbridge` to `trustedDependencies` trades one documented workaround for
another.

### Rejected: Writable Cache Fallback

Copying the binary into `~/.cache/docbridge/bin/<version>/<platform>/` and
executing it from there would defeat both a read-only store and a `noexec`
mount. It is out of scope because:

- The observed evidence supports only the lost-bit cause. Both downstream
  workarounds are plain `chmod +x` against the install location, and a `chmod`
  cannot fix a `noexec` mount — so where the workaround works, the mount is not
  `noexec`. The `noexec` cause in the yodoku comment is a hypothesis, not a
  reproduction.
- It introduces a cache location, invalidation keyed on version and content, and
  concurrent-writer handling — a materially larger surface than the defect
  justifies.

If a `noexec` reproduction appears after Slice 2 ships, the Slice 2 diagnostic
identifies it precisely, and the fallback can be planned then with real
evidence.

## Slice 1: Executability Probe and Repair at Resolution

Purpose: recover the executable bit on DocBridge's own bundled scanner binaries
so `docbridge check` works without a caller-side `chmod`.

Tasks:

- Add an executability check for the resolved candidate in
  `src/core/code-language.ts`. Landed as an effective-permission probe
  (`accessSync(path, X_OK)`) rather than the mode mask this plan first
  proposed: a mode like `0011` carries execute bits that do not apply to the
  owner, and only the effective-permission probe justifies Slice 2 attributing
  a later spawn `EACCES` to the filesystem instead of the mode. `statSync` is
  still used to compute the repaired mode and to report the observed one.
- When the candidate is not executable, attempt `chmodSync(path, mode | 0o111)`
  and use the candidate on success. Execute bits only: `mode | 0o755` would also
  grant group and other read access to a scanner installed `0o600` under a
  restrictive umask, which is more than restoring execution.
- When the repair fails, return `code_scanner_unavailable` with the failure-mode
  2 message from [Decisions](#three-distinguishable-failure-modes).
- Keep the resolution result shape (`ScannerWorkerCommandResolution`) unchanged
  so `createScannerWorkerAdapter` needs no change.
- Extend `ScannerWorkerResolutionOptions` with injectable `stat`/`chmod` seams
  only if the tests cannot be written against a real temp directory; prefer a
  real temp directory.

Tests:

- A `0o644` scanner binary in a temp `distRoot` is repaired and resolution
  returns its path.
- A `0o755` scanner binary is returned untouched, with no chmod attempted.
- A repair failure yields `code_scanner_unavailable` naming the path and the
  observed mode, and does not throw.
- Missing-binary and unsupported-platform messages are unchanged.
- Repair applies to both `swift` and `dart` executable names, and to both the
  source-checkout and `dist/bin/<platform>` candidates.

Verification:

```sh
just test
just typecheck
```

Done when:

- Resolution repairs a non-executable bundled scanner and degrades to a named
  diagnostic when it cannot.

## Slice 2: Exec-Denied Classification and Remediation Text

Purpose: when the binary is executable but the kernel still refuses to run it,
say why and what to do, instead of surfacing a raw spawn error.

Tasks:

- In `src/core/scanner-worker.ts`, classify the spawn error before building
  `code_scanner_unavailable`: an `EACCES`/`EPERM` error from a binary that
  resolution already confirmed executable is the failure-mode 3 case.
- Emit the remediation text for that case, including the binary's directory so
  the mount is identifiable.
- Leave every other spawn error's message as-is; do not blanket-rewrite
  `scannerUnavailableDiagnostic`.

Tests:

- An injected `ScannerWorkerRun` returning an `EACCES` error produces the
  exec-denied message including the binary directory.
- An injected `EPERM` error produces the same classification.
- An `ENOENT` error keeps the existing message.
- A non-`Error` rejection value still produces a readable message.

Verification:

```sh
just test
just typecheck
```

Done when:

- The three failure modes are distinguishable from the diagnostic message alone,
  without reading DocBridge source.

## Slice 3: Packed-Package Regression Coverage

Purpose: exercise the installer that actually drops the bit. The current smoke
test installs with `npm install`, which preserves modes, so it never reproduced
the defect.

Tasks:

- Extend `scripts/smoke-packed-package.ts` to install the tarball with
  `bun install` in a second temp root, in addition to the existing `npm install`
  root.
- Run the existing Swift and Dart fixture checks against the `bun install` root
  under both CLI runtimes.
- Keep `assertInstalledScannerExecutables` as a report, not a gate, for the
  `bun install` root: the bit being absent there is the environment's behavior,
  not a DocBridge regression. The gate is that `docbridge check` succeeds
  anyway.
- Add a case that removes the executable bit explicitly before running `check`,
  so the repair path is covered even if a future Bun release stops dropping it.
- Confirm `just pack-smoke` and the CI job invoking it still pass on
  `darwin-arm64` and `linux-x64`.

Tests:

- `just pack-smoke` covers this; no separate Bun unit test.

Verification:

```sh
just build
just pack-smoke <tarball>
```

Done when:

- A packed package installed with `bun install`, with the executable bit
  stripped, passes `docbridge check` on the Swift and Dart fixtures.

## Slice 4: Specification and Release Documentation

Purpose: make the recovery behavior normative and tell adopters they can delete
their workaround.

Tasks:

- Update [Scanning](../../specs/scanning.md#code-scanning) to state that DocBridge
  restores the executable bit on its own bundled scanner binaries when it finds
  them non-executable, and emits `code_scanner_unavailable` when it cannot.
- Update [Diagnostics](../../specs/diagnostics.md) with the distinguishable
  `code_scanner_unavailable` causes.
- Keep the `@doc`/`@code` pair on `resolveScannerWorkerCommand` accurate; run
  the `docbridge-sync` triage over the changed counterparts.
- Add a CHANGELOG entry under the next release naming issue #74 and stating that
  consumer-side `chmod +x` workarounds can be removed.
- Check the final `## Status` box and `git mv` this plan into `docs/plans/done/`
  in the PR that lands this slice.

Tests:

- None beyond the repository gate.

Verification:

```sh
just verify
```

Done when:

- The recovery behavior is specified, the CHANGELOG states the workaround is no
  longer needed, and this plan is archived.

## Follow-up Work

- Remove the `chmod +x` workaround from `yodoku/justfile` and
  `share-expenses/flake.nix` once a release carrying this fix is pinned. Both
  also hardcode the pre-rename scanner binary paths; drop those recipes once a
  release that includes issue #75 is pinned.
- Revisit the writable-cache fallback only if a `noexec` reproduction surfaces
  through the Slice 2 diagnostic.
