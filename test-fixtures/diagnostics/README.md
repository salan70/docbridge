# Diagnostic Fixtures

Each directory under `test-fixtures/diagnostics/` is a minimal SpecLink project that
fires exactly one diagnostic code. The fixtures serve two roles:

- Manual observation: run `just check-fixture <code>` to see the diagnostic in
  a real project layout (the recipe adds `--audit` for `undocumented_symbol`).
- Regression testing: `src/cli/diagnostic-fixtures.test.ts` runs `check --json`
  against every fixture and asserts that exactly the expected diagnostic
  (code + file + line) fires, so CI keeps each fixture minimal.

`file_read_error` has no fixture: I/O failures cannot be reproduced
deterministically from checked-in files. Unit tests cover that code instead.

`examples/typescript` remains the happy-path showcase; these fixtures only cover
diagnostic paths.
