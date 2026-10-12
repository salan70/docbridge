# Dart specified cases: findings

The cases were written from `docs/specs/scanning.md`, `annotations.md`,
`diagnostics.md`, and `configuration.md` before any case ran against the shipped
worker. Each difference between an expected file and the shipped worker's output
was judged against the specification text. Conclusions:

- `worker`: the specification supports the expected value, which is unchanged
  and fails against the shipped worker.
- `fixture`: the expected value misread the specification and was corrected.
- `unspecified`: the specification is silent, so the expected value follows the
  shipped worker.

Thirty-six cases exist; thirty-five pass against the shipped worker and one is a
`worker` finding.

## Findings

### annotation-unsupported-declaration

- Differed: `diagnostics[0].severity` (expected `warning`, shipped `error`) and
  `diagnostics[0].location` (expected the typedef name at 2:9, shipped the
  declaration start at 2:1).
- Basis: `diagnostics.md` lists `unsupported_declaration` under warning codes,
  and `scanning.md` (Code Scanning) says it points at the declaration's name.
  A `typedef` has a name.
- Conclusion: `worker`. `expected.json` keeps the specified result, so it
  differs from the shipped worker. `shipped-deviation.json` holds the shipped
  worker's current output; the runner compares both the shipped worker and the
  candidate with it and reports `ok*` when they match.

### annotation-unsupported-declaration, `range`

- Differed: the shipped diagnostic carries no `range`; the first draft expected
  the name range.
- Basis: no specification text requires the worker to attach a range to this
  diagnostic; the schema marks it optional.
- Conclusion: `unspecified`. The expected value has no `range`.

### Signature range end (all cases with a body)

- Differed: the shipped `signatureRange` ends at the opening `{` of the body,
  so it includes the whitespace before it (the range of `void login() {}` ends at column 14),
  where the first draft ended directly after `)` (column 13).
- Basis: the specification says the signature range excludes implementation
  bodies and says nothing about the whitespace between the signature and the
  body. The checked-in `scanner-conformance` Dart fixtures also end there.
- Conclusion: `unspecified`. Expected values end at the body's `{`.

### decl-class-constructors, body-less constructor signature

- Differed: for `AuthService();` and `AuthService.guest();` the shipped
  `signatureRange` stops before the trailing `;`, while the `declarationRange`
  and the signature of a body-less field (`int attempts = 0;`) include it.
- Basis: the Dart section is silent. The TypeScript section says a member
  without a body exposes its whole declaration, but it is not stated for Dart.
- Conclusion: `unspecified`. The expected values follow the shipped worker. The
  inconsistency with fields is worth deciding for the candidate.

### decl-top-level-getter-setter, `symbolName` of a setter

- Differed: the first draft expected `token=` (the last canonical ID segment);
  the shipped worker reports `token`.
- Basis: the Dart section defines canonical IDs only. It does not define
  `symbolName`.
- Conclusion: `unspecified`. The expected value is `token`. Unnamed and named
  constructors use the last canonical ID segment (`new`, `guest`) in the shipped
  worker, and the cases follow that.

### position-bom-name, position-bom-target

- Differed: a file that begins with a byte-order mark is reported as
  `code_parse_error` with no symbols; the first draft expected the symbols and
  links of the file with the BOM counted as one column.
- Basis: no specification text mentions a BOM or says whether one is a syntax
  error.
- Conclusion: `unspecified`. The expected value is the shipped rejection. This
  leaves Dart without a position case after a BOM, which the plan asks for:
  the owner must decide whether a BOM is accepted before such a case can exist.

## Choices made where the specification is silent and the shipped worker agreed

- `symbols` holds the documented declarations and `undocumentedSymbols` the
  rest, both in source order, classes before their members. No Dart symbol
  carries `isMember`.
- A declaration's range starts at its leading documentation comment.
- A name's location is the identifier token: `guest` for `AuthService.guest()`,
  and the class name for the unnamed constructor.
- Diagnostic messages are not specified. The expected messages equal the
  shipped worker's text, copied rather than derived.
- An `@doc` on a library-private declaration is not covered: the specification
  does not say whether it is `unsupported_declaration`.
- Same-line characters before an annotation target are not covered, because
  the specification does not say where `@doc` may sit within a comment line.
  Non-BMP and combining characters inside the target are covered instead.
