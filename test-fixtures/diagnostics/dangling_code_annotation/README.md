# dangling_code_annotation

The `@code` annotation is not followed by a heading (only a paragraph), so it
never attaches to an anchor and DocBridge reports `dangling_code_annotation`
(warning). No link is created, so no resolution diagnostic fires.

Run: `just check-fixture dangling_code_annotation`
