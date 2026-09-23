# Diagnostic Fixtures

Each directory under `test-fixtures/diagnostics/` is a minimal DocBridge project that
fires exactly one diagnostic code. The fixtures serve two roles:

- Manual observation: run `just check-fixture <code>` to see the diagnostic in
  a real project layout (the recipe adds `--audit` for `undocumented_symbol`
  and `unlinked_doc_section`).
- Regression testing: `src/cli/diagnostic-fixtures.test.ts` runs `check --json`
  against every fixture and asserts that exactly the expected diagnostic
  (code + file + line) fires, so CI keeps each fixture minimal.

Three codes have no fixture, and unit tests cover them instead:

- `code_scanner_unavailable`: scanner availability depends on the environment.
- `code_scanner_failed`: worker protocol failures are not a project layout.
- `file_read_error`: I/O failures cannot be reproduced deterministically from
  checked-in files.

[Diagnostics](../../docs/specs/diagnostics.md) lists the fixture for every
other code.

`examples/typescript` remains the happy-path showcase; these fixtures only cover
diagnostic paths.
