<!-- @code crates/docbridge/src/output.rs -->
<!-- @code crates/docbridge/src/project.rs -->

# Diagnostics

The CLI reports flat diagnostics in `validate --json`, `links --json`, and `unlinked --json`:

```ts
type QueryDiagnostic = {
  code: string;
  path: string; // root-relative; empty when no file applies
  line?: number;
  message: string;
};
```

| Code             | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `configuration`  | Missing, unreadable, or invalid `docbridge.config.json`, including unknown keys       |
| `annotation`     | An annotation is interrupted by other content or has no heading to attach to          |
| `link`           | An annotation target is missing, not a managed path, or not a code file               |
| `selector`       | A `links` selector is invalid or names a file or section that does not exist          |
| `invalid-path`   | A managed path is not valid UTF-8 or violates the managed-path rules                  |
| `unsafe-path`    | A symlink or reparse point lies inside a managed path; it is reported, never followed |
| `read-directory` | A managed directory could not be read                                                 |
| `read-file`      | A managed file is unreadable, not UTF-8, or binary                                    |
| `read-metadata`  | File metadata could not be read                                                       |
| `usage`          | Invalid CLI arguments (with `--json`, reported as a diagnostic)                       |

Any diagnostic makes the result incomplete (`complete: false`). `validate` exits 1 for errors; `links` exits 2 when usable results remain next to diagnostics. See [vNext public contracts](vnext-contracts.md#exit-codes-and-query-output).
