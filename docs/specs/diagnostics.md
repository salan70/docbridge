# Diagnostics

SpecLink v0.1 diagnostics have this JSON shape:

```ts
type SpecLinkDiagnostic = {
  severity: "error" | "warning";
  code: DiagnosticCode;
  target: string;
  source?: string;
  message: string;
  location?: {
    filePath: string;
    line: number;
    column: number;
  };
};
```

`location.filePath`, `source`, and `target` use project-root-relative paths.

`line` and `column` are 1-based.

For link diagnostics, `source` is the annotation source endpoint and `target` is the annotation target endpoint.

For diagnostics without a separate source, `target` is the affected endpoint or file.

Each code below links to a minimal fixture project under
[fixtures/diagnostics/](../../fixtures/diagnostics/) that fires exactly that
diagnostic; run it with `just check-fixture <code>`.

Error diagnostic codes:

- [`config_file_invalid`](../../fixtures/diagnostics/config_file_invalid/)
- [`config_unknown_key`](../../fixtures/diagnostics/config_unknown_key/)
- [`config_invalid_value`](../../fixtures/diagnostics/config_invalid_value/)
- [`invalid_link_target`](../../fixtures/diagnostics/invalid_link_target/)
- [`doc_file_not_found`](../../fixtures/diagnostics/doc_file_not_found/)
- [`doc_anchor_not_found`](../../fixtures/diagnostics/doc_anchor_not_found/)
- [`code_file_not_found`](../../fixtures/diagnostics/code_file_not_found/)
- [`code_backlink_not_found`](../../fixtures/diagnostics/code_backlink_not_found/)
- [`doc_backlink_not_found`](../../fixtures/diagnostics/doc_backlink_not_found/)
- [`duplicate_doc_anchor`](../../fixtures/diagnostics/duplicate_doc_anchor/)
- [`duplicate_code_symbol`](../../fixtures/diagnostics/duplicate_code_symbol/)
- [`typescript_parse_error`](../../fixtures/diagnostics/typescript_parse_error/)
- `file_read_error` — no fixture; I/O failures are not deterministically
  reproducible from checked-in files, so unit tests cover this code instead.

Warning diagnostic codes:

- [`duplicate_link`](../../fixtures/diagnostics/duplicate_link/)
- [`dangling_code_annotation`](../../fixtures/diagnostics/dangling_code_annotation/)
- [`unsupported_declaration`](../../fixtures/diagnostics/unsupported_declaration/)
- [`undocumented_symbol`](../../fixtures/diagnostics/undocumented_symbol/)

`undocumented_symbol` is emitted only when `--audit` is enabled.

`undocumented_symbol` is endpoint-based. If at least one supported declaration for a `file#name` endpoint has `@doc`, that endpoint is documented. If multiple `@doc`-annotated declarations expose the same endpoint, `duplicate_code_symbol` is emitted instead.

SpecLink sorts diagnostics deterministically:

1. diagnostics without `location` first
2. `location.filePath`
3. `location.line`
4. `location.column`
5. `code`
6. `target`

Exit code policy:

- exit `1` when any error exists
- exit `0` when diagnostics contain only warnings or no diagnostics

<!-- @code src/lsp/diagnostics.ts#toLspDiagnostic -->
## LSP Diagnostics

From v0.2, the Language Server (`speclink lsp`) publishes these same diagnostics
through `textDocument/publishDiagnostics`. The diagnostic computation is
unchanged. The diagnostic codes are identical; v0.2 adds no new codes.

Each `SpecLinkDiagnostic` maps to the LSP `Diagnostic` shape:

- `severity`: `error` maps to `1`, `warning` maps to `2`.
- `range`: the annotation `targetRange` for link-target diagnostics; the element
  range (`nameRange` or `headingTextRange`) for declaration and heading
  diagnostics; the whole line as a fallback when no range is available.
- `code`: the SpecLink diagnostic code string.
- `message`: the diagnostic message.

The server publishes diagnostics for open documents. Because the whole-project
link graph is held in memory, open documents receive correct cross-file
diagnostics. See [LSP](./lsp.md) for the server's document model.

The exit code policy above applies to `speclink check` only; the Language Server
reports through `publishDiagnostics` and does not exit per check.

<!-- @code src/core/diagnostics.ts#sortDiagnostics -->
## Sorting Diagnostics

Diagnostics are sorted deterministically using the ordering above so output is
stable across runs.
