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

## Notes

- Colocated test files never reach `dist/`: `bun build` starts from the CLI
  entry point (`src/cli/index.ts`) and only bundles what it imports.
- For logic changes, write tests first (see the `tdd` skill).
