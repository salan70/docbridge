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

## Notes

- Colocated test files never reach `dist/`: `bun build` starts from the CLI
  entry point (`src/cli/index.ts`) and only bundles what it imports.
- For logic changes, write tests first (see the `tdd` skill).
