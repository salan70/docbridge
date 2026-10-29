# Linking

The source of truth is a Markdown `@code` comment pointing to a managed code file. Place it before an ATX heading (`#` through `######`). The annotation may be followed by more consecutive annotation lines and blank lines, but other text or comments may not. Setext headings are not supported.

```markdown
<!-- @code src/example.ts -->

## Example

Describe the behavior here.
```

A section can link to several files, and a file can link to several sections. Links address files, not symbols. Duplicate links, missing targets, invalid paths, and targets outside the configured scope are errors.

Select sections as `relative/document.md#parent/child`. Each heading component is lowercased, retaining Unicode letters, numbers and underscores; other runs become `-` and edge hyphens are trimmed. An empty slug becomes `section`. Parents are the nearest preceding lower-level headings, even when levels are skipped. Sibling collisions use the first available suffix starting at `-2` in document order; different parents can reuse a component.

A section includes its heading and content through the next heading at the same or higher level, including child sections. Headings and annotations inside fenced code blocks, HTML comments, or `<pre>`, `<script>`, `<style>` and `<textarea>` blocks are not interpreted as structure or links. Such a block starts on a line beginning with the opening tag and ends at the first line containing any of the four closing tags, regardless of which tag opened it. A linked parent covers its children for `unlinked` reporting.
