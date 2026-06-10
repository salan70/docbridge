# typescript_parse_error

`src/example.ts` is not syntactically valid TypeScript, so SpecLink reports
`typescript_parse_error` (error) and suppresses all link diagnostics derived
from that file.

Run: `just check-fixture typescript_parse_error`
