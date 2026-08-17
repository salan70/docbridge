---
description: Write @doc and @code annotations and valid link targets.
---

# Annotations

DocBridge links supported code declarations to Markdown headings. A complete
pair has `@doc` on the declaration and `@code` immediately before the heading.

<!-- @code src/core/links.ts#parseLinkTarget -->

## Target grammar

Both `@doc` and `@code` take a `file#fragment` target:

- The file path is project-root-relative and uses `/` separators.
- `./`, `../`, and absolute paths are invalid.
- The fragment is required. File-only, fragment-only, and same-file targets
  are invalid.
- Optional text after the target is allowed and ignored
  (`@doc docs/auth.md#login-spec human note`).

One declaration may carry multiple `@doc` tags, and one heading may carry
multiple `@code` comments. Each pair is an independent link. Duplicate
annotations from the same source to the same target produce `duplicate_link`.

## Code to documentation

Use a documentation path and heading anchor in a declaration's documentation
comment:

```ts
/**
 * @doc docs/auth.md#login-flow
 */
export function login(): void {}
```

```swift
/// @doc docs/auth.md#login-flow
public func login(email: String, password: String) {}
```

```dart
/// @doc docs/auth.md#login-flow
void login(String email, String password) {}
```

```rust
/// @doc docs/auth.md#login-flow
pub fn login(email: &str, password: &str) {}
```

Swift, Dart, and Rust use their normal documentation comment syntax. Paths are
relative to the configured project root.

An `@doc` on an unsupported declaration produces `unsupported_declaration`. The
same declaration without `@doc` is ignored.

### TypeScript

Supported top-level exported forms: `function`, `class`, `abstract class`,
`interface`, `type`, `enum`, `const enum`, `const` with a single declarator,
named default `function`/`class`, and their `declare` forms in `.ts` files.
Type members are also supported: class methods, properties, getters, setters,
constructors, and static members; interface property and method signatures;
and property and method signatures of a type alias written as an object type
literal.

By default, `public` and `protected` members are included; `private` members
are included only when `include.code.typescript.visibility` lists `private`.
TypeScript `visibility` applies only to type members. Top-level declarations
are scoped by `export`. Members excluded by visibility are not endpoints; an
`@doc` on one is `unsupported_declaration`.

Unsupported examples include anonymous default exports, multi-declarator
`const`, namespaces, re-exports, non-exported declarations, members whose name
is not a plain identifier, enum members, index signatures, call and construct
signatures, and constructor parameter properties.

Canonical IDs omit parameter signatures (`AuthService.login`,
`AuthService.constructor`).

### Swift

Supported forms include top-level and member `class`, `struct`, `enum`,
`protocol`, and `actor`; top-level and member `func`, `var`, `let`, and
`init`; and members declared in extensions, canonicalized as members of the
extended type.

By default only `public` and `open` declarations are included. `internal`
declarations are included when `include.code.swift.visibility` lists
`internal`. An `@doc` on a visibility-excluded declaration is
`unsupported_declaration`.

Member IDs are type-qualified and include argument labels, for example
`AuthService.login(email:password:)`, `AuthService.refresh(_:)`, and
`AuthService.init(email:password:)`.

### Dart

Supported forms include top-level functions, getters, setters, and variables;
`class`, `enum`, `mixin`, and their members; and members declared in
extensions, canonicalized as members of the extended type.

Only public declarations are scanned. Dart marks library-private names with a
leading `_`, so an endpoint is excluded when any segment of its canonical ID
starts with `_`, including a public member of a `_Private` type.
`include.code.dart.visibility` accepts only `public`. An `@doc` on a
visibility-excluded declaration is `unsupported_declaration`.

Member IDs omit parameter signatures (`AuthService.login`). Setters carry a
trailing `=` (`AuthService.token=`). The unnamed constructor is
`AuthService.new`; named constructors keep their name (`AuthService.guest`).

### Rust

Supported forms are `mod` (including nested modules), `struct`, `enum`, free
`fn`, and inherent `impl` methods. Trait definitions, trait-impl methods,
macros, const/static items, unions, and extern blocks are unsupported.

By default only unrestricted `pub` declarations are included. A plain `fn` or
`struct` without `pub` is not an endpoint. Non-`pub` items are included when
`include.code.rust.visibility` lists `private`. An `@doc` on a
visibility-excluded declaration is `unsupported_declaration`.

Canonical IDs use `::` path qualification, for example `normalize`,
`TypingEngine`, `TypingEngine::advance`, and `domain::typing`.

<!-- @code src/core/markdown.ts#scanMarkdown -->

## Documentation to code

Place a standalone HTML comment immediately before the linked heading. The
comment may be indented by 0 to 3 spaces; 4 or more spaces are ignored. The
trimmed comment body must start with `@code`. Blank lines between the comment
and the heading are allowed. Any other text in between produces
`dangling_code_annotation`.

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

The code fragment is the canonical symbol ID emitted by the language scanner.
Use that ID exactly in the `@code` target.

## Anchors and reciprocity

Anchors come from ATX headings (`#` through `######`) only. Setext headings
have no anchors. Empty headings do not create linkable anchors; a `@code`
attached to an empty heading is `dangling_code_annotation`.

The algorithm:

1. Take the heading text after the `#` markers.
2. Lowercase with JavaScript `toLowerCase()`.
3. Collapse runs of whitespace and punctuation to `-`. Unicode letters and
   numbers are preserved.
4. Strip leading and trailing `-`.

Example: `## Login Spec (v2)` becomes `#login-spec-v2`. `# Login Flow`
becomes `#login-flow`.

Duplicate non-empty anchors in the same Markdown file produce
`duplicate_doc_anchor`. The same anchor in different files is allowed.
DocBridge does not add GitHub-style numeric suffixes.

Each direction is validated independently. A target can resolve while still
reporting a missing reciprocal annotation. Run `docbridge check` to validate
targets and pair completeness, and `docbridge graph --json` when you need the
resolved endpoints and edges.
