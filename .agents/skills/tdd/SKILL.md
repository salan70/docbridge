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

- Every crate uses `cargo test`. Run one integration test file with
  `cargo test -p <crate> --test <file-stem>`, and one test by adding its name.
- The release shell scripts under `scripts/` are tested from
  `crates/docbridge-release/tests/` with stubbed commands.

## DocBridge specifics

- Place tests and fixtures as
  [CONTRIBUTING.md#verification](../../../CONTRIBUTING.md#verification)
  describes.
- Markdown parsing changes use small inline Markdown that makes the
  annotation contract obvious.
- Link changes cover both resolving a valid target and the diagnostic paths
  for missing, unmanaged, or invalid targets.
- CLI changes verify output, exit code, or JSON shape through the command
  boundary.
- Schema or config changes cover accepted and rejected shapes.
- Documentation-only changes need no new tests unless they change executable
  examples, CLI contracts, or checked fixtures.

The final report states what failed first, what passed after the change, and
which verification commands ran.
