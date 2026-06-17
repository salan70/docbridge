# code_backlink_not_found

The doc links to `src/example.ts#example` via `@code`, and the code file
exists, but the function carries no `@doc` annotation pointing back to the doc
anchor. The pair is incomplete, so SpecLink reports `code_backlink_not_found`
(error).

Run: `just check-fixture code_backlink_not_found`
