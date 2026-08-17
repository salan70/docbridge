---
description: Write @doc and @code annotations and valid link targets.
---

# Annotations

DocBridge links supported code declarations to Markdown headings. A complete
pair has `@doc` on the declaration and `@code` immediately before the heading.

<!-- @code src/core/links.ts#parseLinkTarget -->

## Code to documentation

Use a documentation path and heading anchor in a declaration's documentation
comment:

```ts
/**
 * @doc docs/auth.md#login-flow
 */
export function login(): void {}
```

Swift, Dart, and Rust use their normal documentation comment syntax with the same
target format. Paths are relative to the configured project root.

<!-- @code src/core/markdown.ts#scanMarkdown -->

## Documentation to code

Place an HTML comment immediately before the linked heading:

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

The code fragment is the canonical symbol ID emitted by the language scanner.
Top-level functions and types normally use their declaration name. Members use
their type-qualified identity. TypeScript member IDs omit parameter signatures,
Swift member IDs include argument labels, Dart member IDs omit parameter
signatures, and Rust member IDs use `::` path qualification.

## Anchors and reciprocity

Markdown anchors use the normalized heading text, such as `# Login Flow`
becoming `#login-flow`. Duplicate headings receive the same numeric suffixes
used by GitHub-style Markdown anchors.

Each direction is validated independently. A target can resolve while still
reporting a missing reciprocal annotation. Run `docbridge check` to validate
targets and pair completeness, and `docbridge graph --json` when you need the
resolved endpoints and edges.
