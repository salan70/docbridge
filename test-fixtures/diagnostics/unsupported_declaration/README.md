# unsupported_declaration

`@doc` is attached to a non-exported function, which is not a supported
declaration (only top-level exported declarations are linkable), so DocBridge
reports `unsupported_declaration` (warning). No link is created.

Run: `just check-fixture unsupported_declaration`
