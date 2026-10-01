# Pending language fixtures

Scanner-conformance cases for languages whose worker exists but whose language
ID is not yet registered in `KNOWN_CODE_LANGUAGES`. The registered corpus under
`test-fixtures/scanner-conformance/` must list exactly the registered languages,
so a pending language keeps its four cases here as
`<language>/<case>/{input.txt,expected.json}` and moves them into the corpus in
the pull request that registers the language.

`scripts/pending-worker-cases.test.ts` runs every case found here through the
worker's source-checkout command and validates the response against
`schemas/scanner-worker.schema.json`.
