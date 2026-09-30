# Testing Convention

DocBridge uses the Bun test runner (`bun test`, wrapped as `just test`).

## Test placement

- Colocate tests with the module they cover: `src/link/graph.ts` is tested by
  `src/link/graph.test.ts` in the same directory.
- There is no separate top-level `test/` directory. Do not create one.
- Name test files `<module>.test.ts`. The runner discovers them automatically;
  no configuration lists test paths.

## Shared test helpers

- Put helpers shared by several test files next to those tests, without the
  `.test` suffix, so the runner does not execute them as suites. Example:
  `src/lsp/fixtures.ts`.

## Type checking

- `just typecheck` runs `tsc --noEmit` over the whole project. `bun build`
  strips types without checking them, so this is the only gate that catches
  type errors. `just verify` composes it with format checks, lint, `just check`,
  `just check-docs`, `just check-ai-assets`, `just typecheck-extension`, and
  `just test` for the pre-commit hook; CI exposes the same checks as separate
  steps for diagnosis.
- The TypeScript toolchain is pinned through `bun.lock` (`typescript`,
  `@types/bun`, and the transitive `@types/node`). Run installs with
  `bun install --frozen-lockfile` so every machine resolves the same types; a
  stale `node_modules` is the usual cause of "type errors on one machine only".

## Scanner workers

- `just test` includes TypeScript, Swift, Dart, Rust, and Go end-to-end
  integration tests. The Swift, Dart, Rust, and Go integration tests spawn the
  built worker binaries, which `just setup` builds for a fresh source checkout.
  Rebuild all four after changing worker code with `just build-test-scanners`.
- `just test-swift-scanner` runs the SwiftPM test suite for
  `packages/swift-scanner`. It requires a Swift 6 toolchain on `PATH`; the Nix
  dev shell intentionally does not provide Swift, and CI installs it
  separately.
- `just test-dart-scanner` runs the Dart package tests for
  `packages/dart-scanner`. The Dart SDK is provided by the Nix dev shell.
- `just test-rust-scanner` runs the Cargo test suite for
  `packages/rust-scanner`. The Nix dev shell provides the Rust toolchain
  pinned by `packages/rust-scanner/rust-toolchain.toml`.
- `just test-go-scanner` runs the Go test suite for `packages/go-scanner`. The
  Nix dev shell provides Go; `just check-go-toolchain`, a prerequisite of every
  Go recipe, fails unless `go env GOVERSION` matches the `go` directive in
  `packages/go-scanner/go.mod`, and `GOTOOLCHAIN=local` stops Go from
  downloading another version. Bump the directive together with the flake
  lock when nixpkgs moves.
- `src/scan/code/conformance.test.ts` runs every case under
  `test-fixtures/scanner-conformance/<case>/<language>/` through the real
  adapter for that language. It compares the result with that directory's
  `expected.json`. Inputs are stored as `input.txt` so formatters and linters
  leave them alone, including cases that must not parse. Every case covers all
  five languages. Expectations stay per language because canonical IDs and
  positions differ by language. When you add a case, review each
  `expected.json` against the input before committing it.
- CI treats the scanner-native test suites as mandatory before the shared
  `just test` gate. Local changes to scanner code should run the matching
  native test plus `just test`.

## Phase 0 parity harness

`packages/rust-core-experiment/` is the Rust port of the link resolver and
graph evaluated under issue #172. `just verify` runs its three gates:
`just test-phase0` (the crate's Cargo tests), `just phase0-fixtures-check`
(fails when `test-fixtures/phase0/generated/` no longer matches what
`just phase0-fixtures` would write from the TypeScript implementation; it
spawns the scanner workers like `just test`), and `just phase0-parity` (builds
`phase0-runner` and diffs its output against every `specified/` and
`generated/` case). `test-fixtures/phase0/specified/` is hand-written from the
specs and is never regenerated; `test-fixtures/phase0-heldout/` is reserved for
review and is outside the parity run.

## Executable examples

`just check-example <lang>` runs `docbridge check` against
`examples/<lang>`, where `<lang>` is `typescript` (the default), `swift`,
`dart`, `rust`, or `go`. Extra flags such as `--json` pass through.

## Repository self-audit

`just test` compares live `check --audit` keys against
[`test-fixtures/self-audit/baseline.json`](../../test-fixtures/self-audit/baseline.json).
The comparison is keyed by diagnostic code and canonical target. Policy for
which endpoints must participate, and how to refresh the baseline, lives in
[Self-audit](self-audit.md). Run `just check-audit-baseline` for a focused
mismatch report. Do not add `just audit` to `just verify`; audit warnings stay
informational at the CLI boundary.

## Notes

- Colocated test files never reach `dist/`: `bun build` starts from the CLI
  entry point (`src/cli/index.ts`) and only bundles what it imports.
- For logic changes, write tests first (see the `tdd` skill).
