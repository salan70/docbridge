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
- `src/example.cjs`: a CommonJS `module.exports` assignment. Only ESM `export`
  declarations are JavaScript endpoints.
- `src/example.py`: a module-level assignment. Python endpoints are `def`,
  `async def`, and `class` declarations.
- `lib/example.rb`: an `attr_reader` call. Ruby endpoints are modules,
  classes, constants, and methods.

Run: `just check-fixture unsupported_declaration`
