# doc_backlink_not_found

The code links to `docs/spec.md#example-section` via `@doc`, and the heading
anchor exists, but the doc has no `@code` annotation pointing back to
`src/example.ts#example`. The pair is incomplete, so DocBridge reports
`doc_backlink_not_found` (error).

Run: `just check-fixture doc_backlink_not_found`
