---
name: tdd
description: Guides t-wada Red-Green-Refactor TDD for DocBridge. Use when implementing features, fixing bugs, or refactoring logic with strict test-first development.
---

# tdd

Every logic change in DocBridge, including bug fixes and features, follows
t-wada style Red-Green-Refactor.

## Rules

- Write a failing test first and confirm it fails for the expected reason
  before writing production code. A bug fix starts with a regression test.
- Make it pass with the smallest change, then refactor only while green.
- A behavior-preserving refactor needs no new failing test. Keep the existing
  tests green, and first add a characterization test when they do not cover
  the code you change.
- Test one externally visible behavior per test and name the test after it.
  Prefer public interfaces and the CLI boundary over private details.
- Do not delete, skip, or weaken a test to make the suite pass. Fix a wrong test
  with an explicit reason.
- Do not write content-existence tests that only freeze wording or file
  contents. Prefer executable behavior contracts.
- Keep setup and literals inside the test that uses them. Duplication is
  acceptable when it keeps each behavior readable.
- Iterate with the focused suite for the code you change; finish with
  `just verify`.

## Test suites

- TypeScript under `src/` and `scripts/` uses `bun:test`; run one file with
  `bun test <file>`.
- A scanner worker under `packages/` uses its native suite,
  `just test-<lang>-scanner`. `just verify` runs only the Python, Ruby, and
  Java worker suites, so run the Swift, Dart, Rust, or Go suite yourself when
  you change that worker. CI runs all of them.

## DocBridge specifics

- Parser and scanner changes use small inline TypeScript or Markdown fixtures
  that make the annotation contract obvious.
- Resolver changes cover both resolving bidirectional links and the diagnostic
  paths for missing files, anchors, and code symbols.
- CLI changes verify output, exit code, or JSON shape through the command
  boundary.
- Schema or config changes cover accepted and rejected shapes.
- Documentation-only changes need no new tests unless they change executable
  examples, CLI contracts, or checked fixtures.

The final report states what failed first, what passed after the change, and
which verification commands ran.
