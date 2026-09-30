# unsupported_declaration

`@doc` is attached to declarations that cannot be link endpoints, so DocBridge
reports `unsupported_declaration` (warning) for each. No links are created.

- `src/example.ts`: a non-exported function. Only top-level exported
  declarations are linkable.
- `src/member.ts`: a `private` class member. Members are scoped by
  `include.code.typescript.visibility`, which defaults to `public` and
  `protected`.
- `internal/example.go`: a group-level comment above `const (`. The group has
  no name, so the annotation cannot name an endpoint; document the spec inside
  the group instead.

Run: `just check-fixture unsupported_declaration`
