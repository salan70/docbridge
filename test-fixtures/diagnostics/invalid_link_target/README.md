# invalid_link_target

The `@doc` target `docs/spec.md` has no `#fragment` part, so it is not a valid
`file#fragment` link target and DocBridge reports `invalid_link_target` (error).

Run: `just check-fixture invalid_link_target`
