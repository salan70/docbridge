---
name: speclink-annotate
description: Create bidirectional SpecLink links between supported code declarations and Markdown sections. Use when asked to link code to its specification, add @doc or @code annotations, annotate new code with docs, or fix SpecLink link diagnostics.
---

# speclink-annotate

Create a SpecLink link pair: a `@doc` tag in the code documentation comment
and a `@code` comment above the Markdown heading. A link is valid only when
both directions exist and point at each other.

Run SpecLink with the project's native invocation: `speclink` on `PATH`, a
repo recipe such as `just check`, or
`bun run /path/to/spec-link/src/cli/index.ts`.

## Link anatomy

Code side — a `@doc` tag in the documentation comment of a supported
declaration:

```ts
/**
 * @doc docs/auth.md#login-spec
 */
export async function login() {}
```

```swift
/// @doc docs/auth.md#login-spec
public struct AuthService {
  public func login(email: String, password: String) {}
}
```

Markdown side — a standalone HTML comment directly above the heading of the
section:

```md
<!-- @code src/auth/login.ts#login -->
## Login Spec
```

Both targets are `file#fragment`: the file path is project-root-relative with
`/` separators (no `./`, `../`, or absolute paths), and the fragment is
required. Optional text after the target is allowed and ignored
(`@doc docs/auth.md#login-spec human note`).

## Rules that decide whether the link resolves

- `@doc` works only on top-level exported declarations: `function`, `class`,
  `abstract class`, `interface`, `type`, `enum`, `const enum`, `const` with a
  single declarator, named default `function`/`class`, and their `declare`
  forms. Anything else (anonymous default exports, multi-declarator `const`,
  namespaces, re-exports, non-exported declarations) produces
  `unsupported_declaration`.
- Swift `@doc` works on supported public/open declarations and configured
  internal declarations. Member endpoints are type-qualified and include
  argument labels, for example `AuthService.login(email:password:)`.
- Dart `@doc` works on supported public declarations. Member endpoints are
  type-qualified without parameter signatures, for example
  `AuthService.login`; setters carry a trailing `=`.
- The code-side fragment is the scanner-produced canonical ID.
- The doc-side fragment is the anchor generated from the ATX heading
  (`#`–`######`): lowercase via JavaScript `toLowerCase()`, Unicode letters
  and numbers preserved, whitespace and punctuation runs collapsed to `-`,
  leading/trailing `-` removed. Example: `## Login Spec (v2)` →
  `#login-spec-v2`. Setext headings have no anchors.
- The `@code` comment must be standalone, indented at most 3 spaces, with the
  body starting with `@code`. Blank lines between the comment and its heading
  are fine; any other text in between makes it `dangling_code_annotation`.
- One declaration may carry multiple `@doc` tags and one heading multiple
  `@code` comments; each pair is an independent link.
- Anchors must be unique within one Markdown file; symbols must be unique
  among annotated declarations in one TypeScript file.

## Procedure

1. Identify the two endpoints: the exported declaration and the Markdown
   section. If the section does not exist yet, write it first — the heading
   text fixes the anchor.
2. Add the `@doc` tag to the declaration's documentation comment (create the
   documentation comment if missing), pointing at the doc file and the
   generated heading anchor.
3. Add the `@code` comment directly above the heading, pointing back at the
   code file and the scanner-produced canonical ID.
4. Verify with `speclink check`. The link is correct only when no diagnostic
   mentions either endpoint.

## Diagnosing check failures

| Diagnostic | Meaning | Usual fix |
| --- | --- | --- |
| `doc_file_not_found` / `code_file_not_found` | target file not in the managed set | fix the path, or extend `speclink.config.json` globs |
| `doc_anchor_not_found` | file found, anchor wrong | regenerate the anchor from the exact heading text |
| `doc_backlink_not_found` / `code_backlink_not_found` | one direction missing | add the missing `@code` or `@doc` side |
| `unsupported_declaration` | `@doc` on an unsupported declaration | move the tag to a supported declaration |
| `dangling_code_annotation` | text between `@code` and the heading | move the comment directly above the heading |
| `invalid_link_target` | malformed `file#fragment` | rewrite the target per the rules above |
