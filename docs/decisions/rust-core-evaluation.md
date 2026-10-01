# Rust Core Evaluation

Issue: [#172](https://github.com/salan70/docbridge/issues/172)
Evidence: [Rust core evaluation report](../reports/2026-10-01-rust-core-evaluation.md)

## Decision

**Stop the evaluation. The core stays in TypeScript.** The Phase 0 result is
inconclusive under the thresholds #172 predeclared, and the evaluation is not
repeated with harder tasks.

## Rationale

The hypothesis was that Rust would make AI agents ship fewer defects than
strict TypeScript in this codebase. Neither arm produced a counted defect in
three tasks, and measured implementation time differed by under 2%. A repeat
with harder tasks could still separate the arms, but the evidence gives no
reason to expect it:

- None of the defects inspected for #172 would have been prevented by Rust's
  type system. They were contract and logic errors, and one occurred in the
  existing Rust worker.
- In the experiment, every Rust compiler rejection was a deliberate red test
  step. The compiler caught no unintended mistake.
- The migration is estimated in #172 at 5–7 Go-language-support units and
  would defer the core integration of the #173 language wave for its duration.

## Consequences

- T1 (multi-suffix languages), T2 (batched dispatch and LSP scheduling), T3
  (runtime-backed workers), and the JavaScript adapter are implemented in the
  TypeScript core as Slice D of the plan, under #173.
- The Phase 0 crate, its snapshots, its oracle and held-out cases, and its
  recipes and CI steps are removed in the change that records this decision,
  as the plan provides for a decision to stop. They remain in the history of
  that pull request.
- The three behaviors the port found unstated in the specs are recorded in the
  report. Any of them can become a documentation or maintenance issue on its
  own merits.
- A later Rust proposal starts from a new issue and should bring evidence
  beyond this record.
