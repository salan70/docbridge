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

Error diagnostic codes:

- `config_file_invalid`
- `config_unknown_key`
- `config_invalid_value`
- `invalid_link_target`
- `doc_file_not_found`
- `doc_anchor_not_found`
- `code_file_not_found`
- `code_backlink_not_found`
- `doc_backlink_not_found`
- `duplicate_doc_anchor`
- `duplicate_code_symbol`
- `typescript_parse_error`
- `file_read_error`

Warning diagnostic codes:

- `duplicate_link`
- `dangling_code_annotation`
- `unsupported_declaration`
- `undocumented_symbol`

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
