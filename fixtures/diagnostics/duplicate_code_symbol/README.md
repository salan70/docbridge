# duplicate_code_symbol

Two `@doc`-annotated declarations (merged `interface Example` declarations)
expose the same code endpoint `src/example.ts#Example`, so SpecLink reports
`duplicate_code_symbol` (error) at the second declaration. The first
declaration forms a valid pair with the doc, so no other diagnostic fires.

Run: `just check-fixture duplicate_code_symbol`
