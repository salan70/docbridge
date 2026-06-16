# code_file_not_found

The `@code` annotation targets `src/missing.ts`, which does not exist in the
managed code set, so SpecLink reports `code_file_not_found` (error).

Run: `just check-fixture code_file_not_found`
