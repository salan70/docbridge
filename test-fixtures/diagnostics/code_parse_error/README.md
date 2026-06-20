# code_parse_error

`src/example.ts` is not syntactically valid TypeScript, so DocBridge reports
`code_parse_error` (error) and suppresses all link diagnostics derived from that
file.

Run: `just check-fixture code_parse_error`
