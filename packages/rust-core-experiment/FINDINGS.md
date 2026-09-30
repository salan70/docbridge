# Phase 0 findings

Observations recorded while porting `src/link/resolver.ts`, `src/link/graph.ts`,
and their helpers to this crate and while writing the `specified/` oracle from
the specs (issue #172, Slice A). Nothing here changes shipped behavior; the
port reproduces the TypeScript output exactly, and the items below are inputs
to the Slice B report and to future spec work.

## Oracle results

Every hand-written `test-fixtures/phase0/specified/` case and every held-out
case passed against the TypeScript implementation on the first run, so no
`expected.json` was revised after seeing the implementation. No behavioral
deviation between the specs and `src/link/` was found.

## Underspecified points the port had to decide

### String order is ICU collation, not byte order

`compareDiagnostics` (`src/model/diagnostics.ts`) and `compareEndpointOrder`
(`src/model/endpoint.ts`) sort with `String.prototype.localeCompare()`, while
`comparePaths` (`src/shared/path-order.ts`) is bytewise. `localeCompare` with
no locale argument is the runtime's default ICU collation, so the order of
`docbridge check` output and of `counterpartsOf` is locale-dependent in
principle and differs from byte order in practice:

- punctuation orders by collation weight, so `src/a_b.ts` sorts before
  `src/a-b.ts`, before `src/a.b.ts`, before `src/a/b.ts`, and every one of
  those before `src/a10.ts`;
- digits sort before letters;
- case is only a tie-breaker (lowercase first), so `docs/api.md` sorts before
  `docs/Api.md` and both before `docs/README.md`.

[Sorting Diagnostics](../../docs/specs/diagnostics.md#sorting-diagnostics)
names the keys but not the string order. The crate reproduces the observed
ICU root order for printable ASCII in `src/collation.rs` and falls back to
code point order for other characters, which no fixture exercises. A spec that
pins the order (or a switch to `comparePaths`, which would reorder shipped
output) is a decision for the core owners, not for this slice.

### Navigation resolves against scanned symbols only

`buildLinkGraph` keys code endpoints by `CodeScanResult.symbols`, which holds
the `@doc`-annotated declarations; `undocumentedSymbols` is not consulted. A
Markdown `@code` link to an unannotated symbol therefore produces
`code_backlink_not_found` and is not navigable, even though the symbol exists
in the file. [Navigation](../../docs/specs/lsp.md#navigation-and-resolvable-one-way-links)
says a target is navigable when it "resolves to an existing file and anchor",
which reads naturally for doc anchors but leaves the code side to the
implementation. `heldout-09` and `heldout-10` freeze the current behavior.

### File-scoped scanner diagnostics require `language`

`collectErroredFiles` treats `code_scanner_unavailable` and
`code_scanner_failed` as file-scoped only when `language` is set and `target`
differs from it. [Link Resolution](../../docs/specs/link-resolution.md) states
the suppression without the `language` condition. Every scanner diagnostic the
core emits carries `language`, so the condition is unobservable today; the
port keeps it.

## Fixture notes

- `test-fixtures/self-audit/` contains only `baseline.json` and no
  `docbridge.config.json`, so `scripts/phase0-fixtures.ts` finds no project
  there and `generated/` holds the 18 diagnostic fixtures and the 5 examples.
  The repository root itself is not snapshotted: its scan changes with every
  `src/` or `docs/` edit and would make `just phase0-fixtures-check` fail on
  unrelated work.
- The generated cases were produced with the four scanner workers built, so
  none of them carries `code_scanner_unavailable`. Regenerating without the
  workers would change the Swift, Dart, Rust, and Go cases.
