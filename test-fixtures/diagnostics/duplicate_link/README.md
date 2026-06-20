# duplicate_link

The function carries two identical `@doc` annotations targeting
`docs/spec.md#example-section`, so DocBridge reports `duplicate_link` (warning)
for the second one. The first annotation forms a valid pair with the doc, so
no other diagnostic fires.

Run: `just check-fixture duplicate_link`
