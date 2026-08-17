<!-- @code src/core/types.ts#DocBridgeDiagnostic -->

# Diagnostics

DocBridge v0.1 diagnostics have this JSON shape:

```ts
type DocBridgeDiagnostic = {
  severity: "error" | "warning";
  code: DiagnosticCode;
  target: string;
  language?: "typescript" | "swift" | "dart" | "rust";
  source?: string;
  message: string;
  location?: {
    filePath: string;
    line: number;
    column: number;
  };
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};
```

`location.filePath`, `source`, and `target` use project-root-relative paths.

`line` and `column` are 1-based.

For link diagnostics, `source` is the annotation source endpoint and `target` is the annotation target endpoint.

For diagnostics without a separate source, `target` is the affected endpoint or file.

Each code below links to a minimal fixture project under
[test-fixtures/diagnostics/](../../test-fixtures/diagnostics/) that fires exactly that
diagnostic; run it with `just check-fixture <code>`.

Error diagnostic codes:

- [`config_file_invalid`](../../test-fixtures/diagnostics/config_file_invalid/)
- [`config_unknown_key`](../../test-fixtures/diagnostics/config_unknown_key/)
- [`config_invalid_value`](../../test-fixtures/diagnostics/config_invalid_value/)
- [`invalid_link_target`](../../test-fixtures/diagnostics/invalid_link_target/)
- [`doc_file_not_found`](../../test-fixtures/diagnostics/doc_file_not_found/)
- [`doc_anchor_not_found`](../../test-fixtures/diagnostics/doc_anchor_not_found/)
- [`code_file_not_found`](../../test-fixtures/diagnostics/code_file_not_found/)
- [`code_backlink_not_found`](../../test-fixtures/diagnostics/code_backlink_not_found/)
- [`doc_backlink_not_found`](../../test-fixtures/diagnostics/doc_backlink_not_found/)
- [`duplicate_doc_anchor`](../../test-fixtures/diagnostics/duplicate_doc_anchor/)
- [`duplicate_code_symbol`](../../test-fixtures/diagnostics/duplicate_code_symbol/)
- [`code_parse_error`](../../test-fixtures/diagnostics/code_parse_error/)
- `code_scanner_unavailable` — no fixture; scanner executable availability is
  environment-dependent, so unit tests cover this code instead. The message
  distinguishes three causes: the binary is missing or the platform is
  unsupported; the binary is not executable and the executable bit could not be
  restored (message names the path, its observed mode, and the error); or the
  binary is executable but the filesystem refuses to execute it, as a `noexec`
  mount does (message names the binary's directory). See
  [Scanning](scanning.md#code-scanning).
- `code_scanner_failed` — no fixture; worker protocol failures are covered by
  unit tests instead of a checked-in project fixture.
- `file_read_error` — no fixture; I/O failures are not deterministically
  reproducible from checked-in files, so unit tests cover this code instead.

Warning diagnostic codes:

- [`duplicate_link`](../../test-fixtures/diagnostics/duplicate_link/)
- [`dangling_code_annotation`](../../test-fixtures/diagnostics/dangling_code_annotation/)
- [`unsupported_declaration`](../../test-fixtures/diagnostics/unsupported_declaration/)
- [`undocumented_symbol`](../../test-fixtures/diagnostics/undocumented_symbol/)
- [`unlinked_doc_section`](../../test-fixtures/diagnostics/unlinked_doc_section/)

`undocumented_symbol` and `unlinked_doc_section` are emitted only when `--audit` is enabled. They are the two audit diagnostics and cover opposite directions of the same gap: code with no specification, and specification with no code.

`undocumented_symbol` is endpoint-based. If at least one supported declaration for a `file#name` endpoint has `@doc`, that endpoint is documented. If multiple `@doc`-annotated declarations expose the same endpoint, `duplicate_code_symbol` is emitted instead.

DocBridge sorts diagnostics deterministically:

1. diagnostics without `location` first
2. `location.filePath`
3. `location.line`
4. `location.column`
5. `code`
6. `target`

Exit code policy:

- exit `1` when any error exists
- exit `0` when diagnostics contain only warnings or no diagnostics

<!-- @code src/core/resolver.ts#resolveLinks -->

## Unlinked Doc Sections

`unlinked_doc_section` reports documentation sections in the configured `include.docs` scope that carry no `@code` annotation. It is located at the heading and targets the heading's `file#anchor` endpoint.

A heading counts as **annotated** when at least one `@code` comment is attached to it, regardless of whether that annotation parses or resolves. A heading whose only annotation produces `invalid_link_target`, `code_file_not_found`, or `code_backlink_not_found` is therefore not also reported here; the error is the actionable diagnostic, and the annotation shows the link was attempted.

Reporting is **rolled up over the heading tree**. The tree uses the same nesting rule as the section extraction behind `docbridge context` and LSP hover, so the region this diagnostic calls unlinked is exactly the region those surfaces display: a heading's descendants are all following headings up to, but excluding, the next heading whose level is less than or equal to its own. Consequently `# A`, `### B`, `## C` places both `B` and `C` under `A`; multiple top-level headings are independent roots; and a document starting at `##` roots there.

Given that tree, DocBridge emits one diagnostic at the **topmost heading of every fully unannotated subtree**, and suppresses every heading beneath it. A heading with no annotation of its own is **not** reported when any of its descendants is annotated, because the subtree is already bridged. This keeps the diagnostic count proportional to the number of unbridged regions rather than to the number of headings, which is what makes it usable on a partially adopted repository.

The message names the endpoint and, when the reported heading has descendants, how many were suppressed:

```text
Doc section docs/spec.md#unlinked has no @code annotation.
Doc section docs/spec.md#overview has no @code annotation (12 descendant headings suppressed).
```

The count appears in the message only; the diagnostic carries no code-specific JSON field.

Empty headings (`##` with no text) create no anchor, so they can never be reported. They do participate in the tree, because an empty heading still closes the section before it: in `### Parent`, `##`, `#### Child`, the empty `##` ends `Parent`, so `Child` is a separate region rather than a descendant of `Parent`, and both are reported. When an empty heading would itself be the reported node, reporting descends through it to its children.

Content before the first heading has no anchor and is out of scope. Sections in doc files that failed to read are suppressed like every other derived diagnostic.

<!-- @code src/lsp/diagnostics.ts#toLspDiagnostic -->

## LSP Diagnostics

From v0.2, the Language Server (`docbridge lsp`) publishes these same diagnostics
through `textDocument/publishDiagnostics`. The diagnostic computation is
unchanged. The diagnostic codes are identical; v0.2 adds no new codes.

Each `DocBridgeDiagnostic` maps to the LSP `Diagnostic` shape:

- `severity`: `error` maps to `1`, `warning` maps to `2`.
- `range`: the annotation `targetRange` for link-target diagnostics; the element
  range (`nameRange` or `headingTextRange`) for declaration and heading
  diagnostics; the whole line as a fallback when no range is available.
- `code`: the DocBridge diagnostic code string.
- `message`: the diagnostic message.

The server publishes diagnostics for open documents. Because the whole-project
link graph is held in memory, open documents receive correct cross-file
diagnostics. See [LSP](./lsp.md) for the server's document model.

The exit code policy above applies to `docbridge check` only; the Language Server
reports through `publishDiagnostics` and does not exit per check.

<!-- @code src/core/diagnostics.ts#sortDiagnostics -->

## Sorting Diagnostics

Diagnostics are sorted deterministically using the ordering above so output is
stable across runs.
