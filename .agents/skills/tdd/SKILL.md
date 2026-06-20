---
name: tdd
description: Guides t-wada Red-Green-Refactor TDD for DocBridge. Use when implementing features, fixing bugs, or refactoring logic with strict test-first development.
---

<!--
Example prompts:
  /tdd
  /tdd implement Markdown @code diagnostics
  /tdd fix link resolution for relative documentation paths
-->

# tdd

Follow strict t-wada style Test-Driven Development for DocBridge code changes.
All logic changes, including bug fixes, new features, and refactors, must follow
Red-Green-Refactor.

DocBridge is a Bun and TypeScript CLI. Prefer the repo-native commands from
`justfile`:

- `just test` for the Bun test suite
- `just check` for the default DocBridge check command
- `just check-example` for the example project
- `just check-example-json` for JSON CLI output
- `just audit` for audit diagnostics
- `just build` for the Bun build

Use focused `bun test` commands during the TDD cycle when possible, then run the
relevant `just` verification commands before reporting completion.

## Cycle

1. **Red** - Write a failing test first. Run it and confirm it fails for the
   expected reason. Do not write production code before this failure exists.
2. **Green** - Write the minimum production code needed to make the failing test
   pass.
3. **Refactor** - Clean up test and production code while keeping tests green.

Repeat the cycle until the requested behavior is complete.

## Rules

- Never write production logic without a failing test that demands it.
- Bug fixes start with a regression test that reproduces the bug.
- Test one behavior per test. Name tests after externally visible behavior, not
  implementation details.
- Keep the green step small. Fake it when useful, then triangulate with more
  tests when the behavior needs generalization.
- Run affected tests after every green step and every refactor step.
- Refactor only when tests are green.
- Do not delete, skip, or weaken a test only to make the suite pass. If a test
  is wrong, fix it with an explicit reason.
- Do not satisfy TDD with content-existence tests that only freeze wording.
  Prefer executable behavior contracts.
- Prefer testing public interfaces and CLI behavior over private implementation
  details.
- Tests are first-class code. Keep names, setup, and assertions readable.
- Do not DRY tests by default. Duplication is acceptable when it makes each
  behavior clearer.

## Workflow

1. Sketch the target behaviors as placeholders, such as `test.todo(...)`.
2. Pick the simplest behavior that can move the implementation forward.
3. Write the test and run it. Confirm Red fails for the expected reason.
4. Write the minimum production code and run the focused test. Confirm Green.
5. Refactor only after Green. Re-run affected tests.
6. Repeat until all behaviors are covered.
7. Run final verification with the relevant `just` commands.

## DocBridge Testing Guidance

- Parser and scanner changes should use small inline TypeScript or Markdown
  fixtures that make the annotation contract obvious.
- Resolver changes should cover both successful bidirectional links and
  diagnostic paths for missing files, anchors, or code symbols.
- CLI changes should verify behavior through the command boundary when the
  externally visible output, exit code, or JSON shape changes.
- Schema or config changes should include tests for accepted and rejected
  configuration shapes where executable coverage is practical.
- Documentation-only changes do not need new tests unless they change executable
  examples, CLI contracts, or checked fixtures.

## Runner Reference

Read `references/bun-test.md` for Bun test commands, modifiers, and TypeScript
test style examples for this repository.

## Key Principles

- When in doubt, write a smaller test.
- Each test should read like a behavior specification.
- If a behavior cannot be named clearly, it is not understood well enough yet.
- The fastest useful test is better than a broad suite during Red-Green.
- The final report must state what failed first, what passed after the change,
  and which final verification commands were run.
