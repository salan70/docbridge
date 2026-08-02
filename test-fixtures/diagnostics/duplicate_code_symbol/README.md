# duplicate_code_symbol

Two `@doc`-annotated declarations expose one code endpoint, so DocBridge reports
`duplicate_code_symbol` (error) at the second declaration. In each case the
first declaration forms a valid pair with the doc, so no other diagnostic fires.

- `src/example.ts`: merged `interface Example` declarations, both annotated,
  exposing `src/example.ts#Example`.
- `src/member.ts`: a getter and a setter, both annotated. A `get`/`set` pair is
  one property in TypeScript and collapses to one endpoint,
  `src/member.ts#Service.token`.

Run: `just check-fixture duplicate_code_symbol`
