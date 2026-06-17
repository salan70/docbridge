# Testing Convention

SpecLink uses the Bun test runner (`bun test`, wrapped as `just test`).

## Test placement

- Colocate tests with the module they cover: `src/core/graph.ts` is tested by
  `src/core/graph.test.ts` in the same directory.
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
  type errors. It runs in CI, in the `pre-commit` hook, and in the agent `Stop`
  hook alongside `just check` and `just test`.
- The TypeScript toolchain is pinned through `bun.lock` (`typescript`,
  `@types/bun`, and the transitive `@types/node`). Run installs with
  `bun install --frozen-lockfile` so every machine resolves the same types; a
  stale `node_modules` is the usual cause of "type errors on one machine only".

## Scanner workers

- `just test` includes TypeScript, Swift, and Dart end-to-end integration
  tests. The Swift and Dart integration tests spawn the built worker binaries,
  so build them first when running from a source checkout:
  `just build-swift-scanner` and `just build-dart-scanner`.
- `just test-swift-scanner` runs the SwiftPM test suite for
  `packages/swift-scanner`. It requires a Swift 6 toolchain on `PATH`; the Nix
  dev shell intentionally does not provide Swift, and CI installs it
  separately.
- `just test-dart-scanner` runs the Dart package tests for
  `packages/dart-scanner`. The Dart SDK is provided by the Nix dev shell.
- CI treats the scanner-native test suites as mandatory before the shared
  `just test` gate. Local changes to scanner code should run the matching
  native test plus `just test`.

## Executable examples

- `just check-example` verifies the TypeScript example under
  `examples/typescript`.
- `just check-swift-example` verifies the Swift example under `examples/swift`.
- `just check-dart-example` verifies the Dart example under `examples/dart`.

## Notes

- Colocated test files never reach `dist/`: `bun build` starts from the CLI
  entry point (`src/cli/index.ts`) and only bundles what it imports.
- For logic changes, write tests first (see the `tdd` skill).
