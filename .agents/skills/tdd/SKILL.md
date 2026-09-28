---
name: tdd
description: Guides t-wada Red-Green-Refactor TDD for DocBridge. Use when implementing features, fixing bugs, or refactoring logic with strict test-first development.
---

# tdd

Every logic change in DocBridge, including bug fixes, features, and refactors,
follows t-wada style Red-Green-Refactor with `bun:test`.

## Rules

- Write a failing test first and confirm it fails for the expected reason
  before writing production code. A bug fix starts with a regression test.
- Make it pass with the smallest change, then refactor only while green.
- Test one externally visible behavior per test and name the test after it.
  Prefer public interfaces and the CLI boundary over private details.
- Do not delete, skip, or weaken a test to make the suite pass. Fix a wrong test
  with an explicit reason.
- Do not write content-existence tests that only freeze wording or file
  contents. Prefer executable behavior contracts.
- Keep setup and literals inside the test that uses them. Duplication is
  acceptable when it keeps each behavior readable.
- Iterate with focused `bun test <file>`; finish with `just verify`.

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
