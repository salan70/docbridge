# Swift specified cases: findings

Every case's `expected.json` was written from the specs before any case ran
against the shipped worker. This file records each disagreement and how it was
judged. Conclusions: `worker` (the spec supports the expectation, which is
kept), `fixture` (the expectation misread the spec and was fixed), and
`unspecified` (the spec is silent, so the expectation follows the shipped
worker).

## annotation-unsupported-declaration

- **Differences**: the diagnostic's `location.column` (expected 18, the name
  `Token`; shipped 1) and `severity` (expected `warning`; shipped `error`).
- **Spec**: [Code Scanning](../../../../docs/specs/scanning.md) says
  `unsupported_declaration` "points at the declaration's name, or at the
  declaration start when it has none"; a `typealias` has a name.
  [Diagnostics](../../../../docs/specs/diagnostics.md) lists
  `unsupported_declaration` under the warning codes.
- **Conclusion**: `worker`. `expected.json` keeps the specified result, so it
  differs from the shipped worker. `shipped-deviation.json` holds the shipped
  worker's current output; the runner compares both the shipped worker and the
  candidate with it and reports `ok*` when they match.

## decl-nested-type

- **Difference**: the member `f` of `Outer.Inner` has canonical ID
  `Inner.f()` in the shipped worker; the expectation was `Outer.Inner.f()`.
- **Spec**: the Swift section only shows IDs qualified by one top-level type
  (`AuthService.login(email:password:)`) and says nothing about members of a
  nested type.
- **Conclusion**: `unspecified`; the expectation now follows the shipped
  worker. The shipped worker is internally inconsistent: the nested type itself
  is `Outer.Inner`, yet its member is qualified by `Inner` alone. The owner
  should decide the rule before a candidate is judged on this case.

## Assumptions the specs do not state

These matched the shipped worker and so produced no difference, but they come
from analogy with other languages rather than from a Swift rule:

- `symbols` holds the `@doc`-annotated symbols and `undocumentedSymbols` the
  rest; no Swift symbol carries `isMember`.
- A duplicate `@doc` target or a duplicate `@doc` endpoint keeps only the first
  link, and the diagnostic is located at the second annotation or the second
  declaration's name.
- Diagnostic messages are not specified; the expectations use the shipped
  wording. `code_parse_error` is compared by `code` alone.
- `signatureRange` ends at the last token before a body's `{`, with no
  trailing space, and covers a stored `var` or `let` entirely.
- A leading byte order mark counts as one UTF-16 code unit of line 1.
