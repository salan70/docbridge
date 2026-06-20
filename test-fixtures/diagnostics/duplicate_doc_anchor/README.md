# duplicate_doc_anchor

Two headings in `docs/spec.md` generate the same anchor `example-section`, so
DocBridge reports `duplicate_doc_anchor` (error) at the second heading.

Run: `just check-fixture duplicate_doc_anchor`
