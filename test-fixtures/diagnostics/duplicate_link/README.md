# duplicate_link

Each TypeScript, Swift, and Dart function carries two identical `@doc` annotations targeting
`docs/spec.md#example-section`, so DocBridge reports `duplicate_link` (warning)
for each second annotation. Each first annotation forms a valid pair with the doc, so
no other diagnostic fires.

Run: `just check-fixture duplicate_link`
