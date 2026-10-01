# Rust Core Evaluation Records, October 2026

Raw records for the [Rust core evaluation report](2026-10-01-rust-core-evaluation.md).
They are copied from the experiment's working files without editing, except
that Markdown headings inside copied text are demoted.

## Setup

- Baseline: commit `505e222` of the Phase 0 branch, whose tree equals
  `ab0bd5f` after the rebase onto `main` in the pull request that adds this
  record.
- Run branches `run/opus-t<task>-<arm>` were local to the experiment machine
  and were not published. Their commits are listed below.
- Agents: Claude Code Agent tool, general-purpose agent, model
  `claude-opus-5-5`, identical prompt template, 45-minute cap, no token cap.
- Reviewer: Codex CLI `codex exec`, model `gpt-6.1-sol`, reasoning `high`,
  read-only sandbox, identical brief per run.
- Review time is the gap between writing the review brief and receiving the
  review, measured from file modification times on the experiment machine.
- Not recorded: compile and type-check wait, and the reviewer's own
  checkpoint steps.

## Port effort (Slice A)

| Step                           | Agent duration | Tokens  |
| ------------------------------ | -------------- | ------- |
| Port, oracle, snapshots, gates | 1,783 s        | 320,066 |
| Five review fixes              | 268 s          | 17,842  |

Model: `claude-fable-5-1`. Parity at the freeze: 45 of 45 cases (12
hand-written, 23 generated, 10 held-out).

## Per-run measurements

| Run                | Commits          | Agent duration | Tokens  | Tool uses | Review time |
| ------------------ | ---------------- | -------------- | ------- | --------- | ----------- |
| Task 1, Rust       | 4414d2b, d681664 | 273.3 s        | 96,604  | 29        | 112 s       |
| Task 1, TypeScript | d3a1a66, 2eb6a33 | 262.3 s        | 100,412 | 36        | 112 s       |
| Task 2, Rust       | 68afa58, 2a39586 | 342.7 s        | 107,921 | 34        | 128 s       |
| Task 2, TypeScript | 90c2fcb, 5ac113f | 375.1 s        | 114,012 | 37        | 143 s       |
| Task 3, Rust       | b343d3e, 246768a | 241.9 s        | 82,612  | 26        | 106 s       |
| Task 3, TypeScript | eed757b          | 207.6 s        | 85,053  | 28        | 93 s        |

## Task 1

### Task statement

#### Task 1: Manifest-aware backlink diagnostics

##### Specification change

A link annotation may carry an optional `origin` field whose only value is
`"manifest"`. It marks a link that a link manifest declared rather than an
annotation in a source or Markdown file.

For a link with `origin: "manifest"`:

- `doc_backlink_not_found` is never emitted for a code → doc link;
- `code_backlink_not_found` is never emitted for a doc → code link.

Every other rule is unchanged: `doc_file_not_found`, `doc_anchor_not_found`,
and `code_file_not_found` still apply to manifest-origin links, a
manifest-origin link still makes its target navigable when it resolves, and
links without `origin` behave exactly as before. `origin` is never echoed in
output; it is an input field only.

Producing `origin` is out of scope: do not change manifest application, the
scanners, or any other producer. Only the resolver consumes the field.

##### Input shape

Every `links[]` entry of `codeFiles[]` and `docFiles[]` in the Phase 0 input
may now carry `"origin": "manifest"`. Entries without the field are ordinary
links.

##### Fixtures

The replacement `input.json` / `expected.json` pairs supplied with this task
replace the same-named cases under `test-fixtures/phase0/specified/`. They are
already in place in your working tree. All other cases are unchanged and must
keep passing.

##### Done when

- Rust arm: `just phase0-parity` passes and `cargo test` passes with new
  table-driven tests for the rule.
- TypeScript arm: `bun test scripts/phase0-oracle.test.ts` and
  `just phase0-fixtures-check` pass, `bun test src/link` passes with new
  tests for the rule, and `just typecheck` passes.

Only your arm's gate matters; the other arm's gate is expected to fail and is
out of scope. Do not edit `docs/specs/`, and do not touch the fixture files
supplied with the task.

### Rust arm

Code diff against the baseline: 3 files changed, 277 insertions(+), 7 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:22:04Z
compile-fail 1 (expected Red: tests reference LinkOrigin / LinkAnnotation.origin before they exist)
gate-fail cargo-fmt-check (new test code not rustfmt-formatted; applied cargo fmt)
done 2026-10-01T03:26:12Z
```

Review:

```text
No defects found against TASK.md and the existing specs. Manifest links skip only backlink diagnostics; target checks, ordinary-link behavior, navigation, and output omission of `origin` are preserved.

Read-only verification: all 35 visible parity cases passed, as did 17 unit tests and 2 fixture tests using existing compiled binaries. No rebuild was performed.

Missing test coverage (not defects):

- An ordinary doc → code link whose backlink is supplied by a manifest-origin code → doc link. The new tests cover only the opposite mixed-origin direction.
- Exact locations, ranges, messages, and final ordering for manifest-origin missing-target diagnostics. The new resolver tests compare only diagnostic code, source, and target; visible fixtures exercise these failures with ordinary links.

defects S1/S2/S3 = 0/0/0
```

### TypeScript arm

Code diff against the baseline: 4 files changed, 149 insertions(+), 2 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:22:05Z
gate-fail format-check-ox (long lines in new test table; fixed with oxfmt)
gate-fail lint-ox (consistent-function-scoping: fromManifest helper nested in describe)
done 2026-10-01T03:26:02Z
```

Review:

```text
No defects found in `git diff 505e222 HEAD -- src scripts`. Both backlink diagnostics are suppressed only for manifest-origin links; target checks, navigation, and output remain consistent with TASK.md and the existing specs.

Missing test coverage, separate from defects:

- Mixed manifest-origin and ordinary links in one file where the ordinary link still needs a backlink diagnostic.
- An ordinary doc → code link satisfied by a manifest-origin code → doc backlink; the added test covers the opposite direction.
- Full diagnostic location/range and ordering assertions for manifest-origin links with missing targets. Added tests check diagnostic codes and absence of `origin`.

Verification: 26 selected tests passed, including all visible Phase 0 oracle cases; `just typecheck` passed. Full build and fixture-generation gates were omitted to preserve the read-only worktree.

defects S1/S2/S3 = 0/0/0
```

## Task 2

### Task statement

#### Task 2: Section-range audit

##### Specification change

`unlinked_doc_section` always carries a `range`, and that range covers the
whole unlinked section instead of the heading text:

- `range.start` is the reported heading's location (the same position as the
  diagnostic's `location`);
- `range.end` is the location of the next heading in document order whose
  level is less than or equal to the reported heading's level, counting empty
  headings, or the document's end position when no such heading follows.

The diagnostic's `location`, `target`, `message`, severity, roll-up rule, and
sort order are unchanged. Diagnostics other than `unlinked_doc_section` are
unchanged.

##### Input shape

Two additions to the Phase 0 input:

- every entry of `docFiles[].headings[]` carries a required `location`
  (`{ filePath, line, column }`), the start of the heading line, including
  empty headings that have no `anchor`;
- every `docFiles[]` entry carries a required `endOfFile` (`{ line, column }`),
  the document's end position.

Headings with an anchor have `location` equal to their anchor's location.

##### Fixtures

The replacement `input.json` / `expected.json` pairs supplied with this task
replace the same-named cases under `test-fixtures/phase0/specified/`. They are
already in place in your working tree. All other cases are unchanged and must
keep passing.

`test-fixtures/phase0/generated/` has been removed from your working tree for
this task: those cases are regenerated from real projects and cannot carry the
new input fields until the Markdown scanner produces them, so they are out of
scope for both arms.

##### Done when

- Rust arm: `just phase0-parity` passes and `cargo test` passes with new
  table-driven tests for the rule.
- TypeScript arm: `bun test scripts/phase0-oracle.test.ts` passes,
  `bun test src/link src/model src/scan/markdown` passes with new tests for
  the rule, and `just typecheck` passes. The `DocHeadingOutline` and
  `MarkdownScanResult` types gain the new fields; the Markdown scanner and
  every other producer must be updated only as far as `just typecheck`
  requires, filling the new fields with correct values for real Markdown files
  (cover that with unit tests). `just phase0-fixtures-check` is out of scope.

Only your arm's gate matters; the other arm's gate is expected to fail and is
out of scope. Do not edit `docs/specs/`, and do not touch the fixture files
supplied with the task.

### Rust arm

Code diff against the baseline: 4 files changed, 207 insertions(+), 17 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:27:13Z
compile-fail 1 (expected Red: new test references DocHeadingOutline.location and build_heading_tree(headings, end_of_file) before they exist)
gate-fail cargo-fmt-check
gate-fail cargo-clippy
done 2026-10-01T03:32:25Z
```

Review:

```text
No defects found against TASK.md and the existing specs.

Read-only verification using existing binaries passed: 15 unit tests, all 13 visible fixtures, and 250 independent randomized heading/range checks. Binaries were not rebuilt.

Missing repository test coverage (not defects):

- An empty heading at the **same level** closes the preceding section; the explicit empty-boundary case uses a shallower heading.
- A rolled-up section containing deeper headings ends at a later sibling or ancestor heading; the explicit roll-up range case ends at EOF.

defects S1/S2/S3 = 0/0/0
```

### TypeScript arm

Code diff against the baseline: 7 files changed, 223 insertions(+), 40 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:27:14Z
compile-fail 1
gate-fail oxfmt
done 2026-10-01T03:33:04Z
```

Review:

```text
- **S2 — `src/scan/markdown/markdown.ts:131`:** EOF calculation uses lines split only on `\n`, so a lone carriage-return line break is counted as a character. Concrete input: `scanMarkdown("docs/a.md", "# A\nbody\r")`. With audit enabled, the diagnostic’s `range.end` is `{line: 2, column: 6}`; the document ends at `{line: 3, column: 1}`. This violates TASK.md’s requirement to populate correct EOF positions for real Markdown files.

Missing test coverage (separate from defects):

- Lone-CR line breaks and mixed line endings.
- EOF columns after supplementary Unicode characters, verifying UTF-16 counting.
- An empty heading at the **same** level closing a reported section; the existing empty-heading range case uses a higher-level boundary.

Verification: 126 selected tests passed, including all visible oracle fixtures; `just typecheck` passed. Four resolver integration tests were filtered out to keep execution read-only. No S1 or S3 defects found.

defects S1/S2/S3 = 0/1/0
```

## Task 3

### Task statement

#### Task 3: Degree-ranked counterparts

##### Specification change

The link graph exposes the **degree** of an endpoint: the number of distinct
counterparts it has (the size of its counterpart set, zero for an endpoint
without edges or unknown to the graph).

`counterpartsOf` orders its result by the counterpart's degree, descending,
and then by the existing order (file path, then position, then endpoint).
The ordering is stable: counterparts with equal degree keep their existing
relative order.

Diagnostics are unchanged. The Phase 0 runner output shape is unchanged; only
the order of `counterparts[query]` entries changes.

##### Input shape

Unchanged.

##### Fixtures

The replacement `input.json` / `expected.json` pairs supplied with this task
replace the same-named cases under `test-fixtures/phase0/specified/`. They are
already in place in your working tree. All other cases are unchanged and must
keep passing.

##### Done when

- Rust arm: `just phase0-parity` passes and `cargo test` passes with new
  table-driven tests for `degree` and the ranking.
- TypeScript arm: `bun test scripts/phase0-oracle.test.ts` and
  `just phase0-fixtures-check` pass, `bun test src/link` passes with new
  tests for `degree` and the ranking (expose `degree(graph, endpoint)` from
  `src/link/graph.ts`), and `just typecheck` passes.

Only your arm's gate matters; the other arm's gate is expected to fail and is
out of scope. Do not edit `docs/specs/`, and do not touch the fixture files
supplied with the task.

### Rust arm

Code diff against the baseline: 1 file changed, 247 insertions(+), 12 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:34:03Z
compile-fail 1 (expected Red: degree not defined yet)
gate-fail cargo-fmt-check (test table layout; fixed with cargo fmt)
done 2026-10-01T03:37:31Z
```

Review:

```text
No defects found in `git diff 505e222 HEAD -- packages/rust-core-experiment`. Degree counts distinct counterparts, ranking uses descending counterpart degree, and ties retain the existing comparator. Diagnostics and output shape remain unchanged.

Missing coverage (not a defect): a ranking case combining duplicate annotations and reciprocal backlinks with competing endpoints of different degrees. Deduplication and ranking are tested separately.

Verification: all 35 visible fixtures matched the prebuilt runner’s output. Existing test binaries passed 16 unit tests and 2 fixture tests. No rebuild or worktree writes were performed.

defects S1/S2/S3 = 0/0/0
```

### TypeScript arm

Code diff against the baseline: 2 files changed, 73 insertions(+), 4 deletions(-).

`RUN_LOG.md`:

```text
2026-10-01T03:34:03Z
done 2026-10-01T03:36:51Z
```

Review:

```text
No defects found in `git diff 505e222 HEAD -- src scripts`. The implementation matches TASK.md: distinct-counterpart degree, descending degree ranking, and the existing ordering for ties.

Missing test coverage (not defects):

- Direct `degree` assertions for Markdown-only links and reciprocal `@doc`/`@code` pairs. Visible fixtures exercise these through ranking.
- `degree` for a known code endpoint with no resolved edges. The new unannotated `orphan` is absent from the graph, so it tests an unknown endpoint.

Verification: oracle and graph tests passed (26 tests); typecheck and fixture checks passed. The full link/oracle suite had 62 passes and three failures caused by sandbox denial of temporary-directory creation. No worktree files were written.

defects S1/S2/S3 = 0/0/0
```

## Notes and adjudication

- Note t2-rust: removing generated/ made tests/fixtures.rs panic, so the run changed it to skip an absent directory. This is a package-induced change (the TypeScript oracle test already skips absent roots), not counted as a defect or rework.
- Note t2-ts: the TypeScript arm also had to make the Markdown scanner produce heading locations and endOfFile (inherent to the arm: the Rust crate has no scanner). Its report flags an LSP consequence (whole-section highlight) and the diagnostics.md LSP sentence that would drift; both are out of the experiment's scope.
- Adjudication t2-ts: the reviewer reported one S2, that `endOfFile` counts a lone CR as a character (`"# A\nbody\r"` gives `{2,6}`, the reviewer expected `{3,1}`). The baseline Markdown scanner (`505e222:src/scan/markdown/markdown.ts:41`) splits lines on LF only, so every position it reports already treats a lone CR as an ordinary character; the new `endOfFile` follows the same line model. Not counted as a defect. Even if counted, it lies in the Markdown scanner, a surface only the TypeScript arm had to change, so it would not be comparable across arms.

## Discarded series

The `claude-fable-5-1` series stopped during task 2 at a usage limit, and its
task 2 runs were discarded. Its task 1 runs used the first task package, which
replaced generated snapshot inputs and was corrected before the counted series.

| Run                | Agent duration | Tokens  | Held-out | Review       |
| ------------------ | -------------- | ------- | -------- | ------------ |
| Task 1, Rust       | 295.6 s        | 76,310  | 10/10    | 0/0/0        |
| Task 1, TypeScript | 599.0 s        | 117,109 | 10/10    | not reviewed |
