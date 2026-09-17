---
description: Choose, create, and semantically review @doc and @code links.
---

# Linking

DocBridge connects supported code declarations to Markdown headings. This
guide covers the complete workflow: choose meaningful sections, create a
reciprocal annotation pair, and review whether the relationship is still true.

## Choose what to link

Prefer sections that define behavior, contracts, inputs and outputs,
constraints, user-visible behavior, or design decisions. README files,
changelogs, contribution guides, runbooks, and release notes are excluded by
default unless a specific section acts as an enduring specification.

Prefer supported public API declarations as code targets. Do not force a link
when no declaration implements or represents the section, and do not use link
annotations to encode branch, review, or release policy.

## Propose candidates docs-first

1. Confirm which documentation directories are in scope.
2. Prioritize unlinked specification sections.
3. Propose no more than three code symbols per section, with a short reason and
   any uncertainty.
4. Classify each section as adopt, exclude, or hold.
5. Add annotations only after the section-level decision is clear.

Use `docbridge check --audit` to find unlinked sections and undocumented public
symbols. Audit diagnostics are candidates for judgment, not instructions to
link every item.

<!-- @code src/core/links.ts#parseLinkTarget -->

## Target grammar

Both annotations take a project-root-relative `file#fragment` target:

- use `/` path separators;
- include both file and fragment;
- do not target the file that contains the annotation (same-file targets are invalid);
- do not use `./`, `../`, absolute paths, or whitespace inside the target; and
- optionally add human-readable text after the target.

One declaration may have multiple `@doc` tags, and one heading may have
multiple `@code` comments. Each pair is independent. Repeating the same target
from the same source produces `duplicate_link`.

## Code to documentation

Put `@doc` in the declaration's documentation comment:

```ts
/** @doc docs/auth.md#login-flow */
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

Paths are relative to the configured root. An annotation on an unsupported or
visibility-excluded declaration produces `unsupported_declaration`; the same
declaration without an annotation is ignored.

### TypeScript declarations

Supported top-level exported forms include functions, classes, interfaces,
type aliases, enums, and single-declarator constants, including supported
`declare` and named default forms. Supported members include class methods,
properties, accessors, constructors, and static members; interface members;
and members of object-literal type aliases.

Members use type-qualified IDs without parameter signatures, such as
`AuthService.login` and `AuthService.constructor`. Visibility defaults to
`public` and `protected`; configure `private` explicitly. Anonymous default
exports, namespaces, re-exports, multi-declarator constants, computed member
names, enum members, and call/index/construct signatures are not endpoints.

### Swift declarations

Supported forms include top-level and member types, functions, variables,
constants, initializers, actors, protocols, and extension members. Visibility
defaults to `public` and `open`; configure `internal` explicitly. Member IDs
include argument labels, for example
`AuthService.login(email:password:)`.

### Dart declarations

Supported forms include top-level functions, accessors, and variables; classes,
enums, mixins, constructors, fields, and methods; and extension members. Dart
supports public endpoints only. Any canonical-ID segment beginning with `_` is
private. Member IDs omit parameter signatures; setters end in `=`, the unnamed
constructor ends in `.new`, and named constructors retain their name.

### Rust declarations

Supported forms are modules, structs, enums, free functions, and inherent
`impl` methods. Visibility defaults to unrestricted `pub`; configure `private`
to include non-`pub` items. Trait definitions and implementations, macros,
constants, statics, unions, and extern blocks are not endpoints. IDs use `::`
qualification, such as `TypingEngine::advance`.

<!-- @code src/core/markdown.ts#scanMarkdown -->

## Documentation to code

Place a standalone HTML comment immediately before the linked ATX heading.
Zero to three leading spaces and blank lines before the heading are allowed;
other intervening content produces `dangling_code_annotation`.

```md
<!-- @code src/auth.ts#login -->

## Login Flow
```

Use the scanner-produced canonical symbol ID exactly.

## Heading anchors and reciprocity

DocBridge creates anchors from ATX headings only. It lowercases the heading,
collapses runs of whitespace and punctuation to `-`, preserves Unicode letters
and numbers, and removes leading and trailing hyphens. `## Login Spec (v2)` is
`#login-spec-v2`.

Empty headings have no anchor; a `@code` annotation attached to an empty
heading produces `dangling_code_annotation`. Duplicate non-empty anchors in
one file produce `duplicate_doc_anchor`; DocBridge does not add GitHub-style
numeric suffixes.
Each direction is validated independently, so a resolving target can still
report a missing backlink. Run `docbridge check` after every edit.

<!-- @code src/core/link-manifest.ts#loadLinkManifest -->

## Declare links in a manifest

Some teams do not accept tool-specific markers in their source files. Those
projects can declare every link in an optional root file
`docbridge.links.json` and write no annotation at all. Annotation linking
stays the recommended style, and the two styles work together in one project.

```json
{
  "$schema": "./schemas/docbridge.links.schema.json",
  "links": [
    {
      "code": "src/auth.ts#AuthService.login",
      "doc": "docs/auth.md#login-flow",
      "note": "optional, for human readers only"
    }
  ]
}
```

One entry declares both directions, so a manifest link never reports a missing
backlink. DocBridge checks only that both targets exist. `check`, `related`,
`context`, `graph`, and editor navigation treat the result exactly like an
annotation pair.

Two diagnostics are specific to the manifest. A `code` target whose file is in
scope but whose symbol does not exist reports `code_symbol_not_found` with a
`Did you mean` suggestion. An entry that repeats an existing link reports
`duplicate_link`.

The cost is that a declared link is invisible to someone reading the code or
the document. Run `related --gate` in continuous integration so a change to
one side still surfaces the other.

## Semantic link review

`docbridge check` proves mechanics. A semantic review asks whether each linked
section and symbol still describe the same behavior or contract.

1. Run `docbridge graph --json --include-content` and read diagnostics first.
2. Review one documentation file at a time and read both endpoints.
3. Compare behavior, inputs, outputs, constraints, and design intent.
4. Report High findings for wrong or stale links, Medium for partial or
   ambiguous relationships, and Low for cleanup or excessive linkage.
5. Include both endpoints, evidence, and a recommended fix for each finding.

Do not edit or remove annotations merely because the relationship is uncertain.
Prefer fewer precise links over broad many-to-many relationships.

## Next steps

- Run `docbridge docs show commands` to inspect the graph or related content.
- Run `docbridge docs show automation` before wiring hooks or CI.
- Run `docbridge docs show troubleshooting` for named diagnostics.
