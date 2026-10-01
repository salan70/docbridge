# Rust Core Evaluation, October 2026

The Phase 0 experiment of [issue #172](https://github.com/salan70/docbridge/issues/172)
is **inconclusive** under the thresholds #172 predeclared. Both arms finished
three tasks with zero counted defects, so neither language showed a defect
advantage. Measured cost was close: the Rust arm's runs took 1.5% more agent
time and 4.1% fewer tokens, and added 64% more lines for the same behavior.

This is a dated observation from 2026-10-01, not current guidance. The raw
records are in [Rust core evaluation records](2026-10-01-rust-core-evaluation-records.md),
the procedure in Slices A and B of the
[language wave and Rust evaluation plan](../plans/language-wave-and-rust-evaluation-plan.md),
and the resulting decision in [Rust core evaluation](../decisions/rust-core-evaluation.md).

## Method

**Port (Slice A).** An agent ported `src/link/resolver.ts`, `src/link/graph.ts`,
and their helpers to an isolated Rust crate with a JSON runner. At the freeze
the crate matched 45 of 45 frozen cases: 12 hand-written oracle cases written
from the specs before the port, 23 snapshots generated from the repository's
fixture and example projects, and 10 held-out cases. A Codex review of the port
raised five points. Four were fixed (UTF-16 path order, `__proto__` query keys,
key-order-insensitive snapshot checks, and labelling oracle assertions that
encode implementation choices). The fifth, ordering of non-ASCII strings, was
documented as a known divergence: the crate reproduces the observed collation
for printable ASCII only, and no frozen case contains non-ASCII text.

**Freeze.** Every run started from the same commit, which held the
parity-complete crate and the unchanged TypeScript `src/link/`.

**Comparison (Slice B).** Each of three specification changes was implemented
once per arm by a fresh agent context. "Exercising" cases are those whose
expected output the rule changes.

| Task | Change                                                                                                   | Visible cases exercising the rule | Held-out cases exercising the rule |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------- |
| 1    | Links with `origin: "manifest"` skip `doc_backlink_not_found` and `code_backlink_not_found`              | 5                                 | 4                                  |
| 2    | `unlinked_doc_section` ranges cover the whole section; the input gains heading locations and `endOfFile` | 2                                 | 6                                  |
| 3    | The graph exposes `degree`, and counterparts are ranked by descending degree, then by the existing order | 2                                 | 3                                  |

Every run used the same prompt template, model, tools, and 45-minute cap,
with no token cap. The agent logged compiler rejections, gate failures after it
believed it was done, and rework in `RUN_LOG.md`. At "ready for review", the
reviewer applied the task's private held-out replacements and ran the arm's
gate over them. Codex then reviewed each run's diff independently and
classified defects as S1 (wrong on a visible case), S2 (wrong only on an
uncovered input), or S3 (non-contractual).

## Results

The counted series used `claude-opus-5-5` for both arms. Per-run commits, task
statements, logs, and reviews are in the records.

| Run    | Agent duration | Tokens  | Compiler rejections  | Gate failures    | Rework | Held-out | Review S1/S2/S3          | Lines added / removed |
| ------ | -------------- | ------- | -------------------- | ---------------- | ------ | -------- | ------------------------ | --------------------- |
| 1 Rust | 273.3 s        | 96,604  | 1, deliberate red    | 1 (format)       | 0      | 10/10    | 0/0/0                    | 277 / 7               |
| 1 TS   | 262.3 s        | 100,412 | 0                    | 2 (format, lint) | 0      | 10/10    | 0/0/0                    | 149 / 2               |
| 2 Rust | 342.7 s        | 107,921 | 1, deliberate red    | 2 (format, lint) | 0      | 10/10    | 0/0/0                    | 207 / 17              |
| 2 TS   | 375.1 s        | 114,012 | 1, three test errors | 1 (format)       | 0      | 10/10    | 0/1/0, adjudicated 0/0/0 | 223 / 40              |
| 3 Rust | 241.9 s        | 82,612  | 1, deliberate red    | 1 (format)       | 0      | 10/10    | 0/0/0                    | 247 / 12              |
| 3 TS   | 207.6 s        | 85,053  | 0                    | 0                | 0      | 10/10    | 0/0/0                    | 73 / 4                |

| Total per arm                   | Rust      | TypeScript | Rust vs TypeScript |
| ------------------------------- | --------- | ---------- | ------------------ |
| Agent duration                  | 857.9 s   | 845.0 s    | +1.5%              |
| Review time                     | 346 s     | 348 s      | −0.6%              |
| Agent duration plus review time | 1,203.9 s | 1,193.0 s  | +0.9%              |
| Tokens                          | 287,137   | 299,477    | −4.1%              |
| S1 + S2 defects                 | 0         | 0          | none               |
| Lines added                     | 731       | 445        | +64%               |

Observations beyond the thresholds:

- Every Rust compiler rejection was the deliberate red step of test-first
  development. The compiler caught no unintended mistake in any Rust run. The
  TypeScript checker caught three unintended test-code errors in task 2.
- Every gate failure in both arms was formatting or a style lint; none
  concerned behavior.
- The adjudicated S2 in task 2 TypeScript: the review reported that
  `endOfFile` counts a lone carriage return as a character. The baseline
  Markdown scanner splits lines on LF only, so every position it reports
  already treats a lone CR as an ordinary character, and the new field follows
  that model. It is not counted. It also lies in the Markdown scanner, which
  only the TypeScript arm had to change, because the crate has no scanner.
- Every review listed one to three cases of missing test coverage in both
  arms, such as mixed manifest and ordinary links, or an empty heading at the
  same level closing a section.

## Threshold evaluation

| Predeclared criterion (#172)                                | Observed                               | Met                |
| ----------------------------------------------------------- | -------------------------------------- | ------------------ |
| At least 30% fewer post-check defects in Rust               | 0 versus 0                             | No                 |
| No higher severity in Rust                                  | No defects in either arm               | Yes                |
| No greater reviewer effort in Rust                          | 346 s versus 348 s of review time      | Yes                |
| At most 20% more total task time in Rust                    | +0.9%, agent duration plus review time | Yes, approximately |
| Complete parity                                             | 45 of 45 frozen cases at the freeze    | Yes                |
| Inconclusive: at most one S1 or S2 per arm over three tasks | 0 and 0                                | Yes                |

Go-to-pilot needs the first criterion, which cannot be met when the
TypeScript arm has no defects. No-go needs materially higher cost, which was
not observed. The result is therefore inconclusive, and #172 requires the
decision record to choose between one repeat with harder tasks and stopping.

Time to acceptance was not measured directly. The approximation above omits
the reviewer's own checkpoint steps, which were the same for both arms.

## Deviations from the plan

- **Model series.** The runs started on `claude-fable-5-1`. Its task 2 runs
  were cut off by a usage limit and discarded, so the model would have changed
  within the series. All six counted runs were rerun on `claude-opus-5-5`.
  The discarded series is summarized in the records and not counted.
- **No preparatory typing in the TypeScript arm.** The plan allowed branded
  endpoint and path types and exhaustiveness checks before the freeze. They
  were not added, so the TypeScript arm ran as the core is today. That choice
  can only have favored the Rust arm, which still showed no advantage.
- **Task 3 output shape.** The plan had the runner's counterpart entries gain
  `degree`. The task kept the output shape and changed only the order, because
  a new output field would have required runner and oracle changes in both
  arms unrelated to the rule.
- **Task package corrections.** The first task 1 package also replaced
  `generated/` snapshot inputs, which the TypeScript arm regenerates from real
  projects and so could not reproduce. The counted series used a corrected
  package that replaces only hand-written cases. Task 2 removed `generated/`
  from both arms, because generated inputs cannot carry the new fields until
  the Markdown scanner produces them. The Rust task 2 run then had to make its
  fixture test skip a missing `generated/` directory, as the TypeScript oracle
  test already did.
- **Lost `__proto__` query.** The task packages were built from a copy of the
  oracle taken before the port review added a `__proto__` query to
  `query-kinds`. Tasks 1 and 2 therefore replaced that case with a version
  without the query. This changed one more expected file in task 2 without
  exercising its rule, and the counted runs did not re-test `__proto__` keys.
- **Concurrency.** The two arms of each task ran at the same time on one
  machine; tasks ran one after another. Contention was not measured.

## Limits

The tasks took three to six minutes each. They were small enough that one
capable agent completed them correctly in either language, so the experiment
had little power to detect a defect difference. One model family performed
both arms, and Codex performed every review.

## Findings about the current core

The port surfaced three behaviors that the specs do not state. None is a
defect, and none changes shipped output.

1. **Diagnostic and counterpart order use locale collation.**
   `compareDiagnostics` and `compareEndpointOrder` sort with
   `String.prototype.localeCompare` in the runtime's default locale; the
   experiment machine produced ICU root order, where punctuation sorts by
   collation weight, digits sort before letters, and case only breaks ties.
   `comparePaths` uses UTF-16 code-unit order instead.
   [Sorting Diagnostics](../specs/diagnostics.md#sorting-diagnostics) names the
   keys but not the string order.
2. **Navigation resolves code targets against annotated symbols only.**
   `buildLinkGraph` keys code endpoints by `symbols`, not `undocumentedSymbols`,
   so a Markdown `@code` link to an unannotated symbol is not navigable unless
   the link manifest promotes that symbol.
   [Navigation](../specs/lsp.md#navigation-and-resolvable-one-way-links) leaves
   the code side implicit.
3. **File-scoped scanner failures require `language`.** `collectErroredFiles`
   treats `code_scanner_unavailable` and `code_scanner_failed` as file-scoped
   only when `language` is set. Every scanner diagnostic the core emits sets
   it, so the condition is not observable today.
