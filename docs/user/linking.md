---
description: Choose, create, and semantically review @doc and @code links.
---

# Linking

DocBridge connects supported code declarations to Markdown headings. This
guide covers the complete workflow: choose meaningful sections, create a
reciprocal annotation pair, and review whether the relationship is still true.
The exact contracts are in the
[Annotations](https://github.com/salan70/docbridge/blob/main/docs/specs/annotations.md),
[Link resolution](https://github.com/salan70/docbridge/blob/main/docs/specs/link-resolution.md),
and [Link manifest](https://github.com/salan70/docbridge/blob/main/docs/specs/link-manifest.md)
specifications.

## Choose what to link

Prefer sections that define behavior, contracts, inputs and outputs,
constraints, user-visible behavior, or design decisions. Do not link README
files, changelogs, contribution guides, runbooks, or release notes unless a
specific section acts as an enduring specification. `docbridge init` skips
conventional files such as `README.md`, `CHANGELOG.md`, and `CONTRIBUTING.md`
when it chooses a documentation directory. DocBridge still scans every
Markdown file that the configured `docs` patterns match, including a proposed
`docs/**/*.md`, so narrow the patterns to keep these files out of the graph.

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

<!-- @code src/model/link-target.ts#parseLinkTarget -->

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

```go
// Login starts the login flow.
//
// @doc docs/auth.md#login-flow
func Login(email, password string) error { return nil }
```

```js
/** @doc docs/auth.md#login-flow */
export function login(email, password) {}
```

```python
def login(email: str, password: str) -> None:
    """Start the login flow.

    @doc docs/auth.md#login-flow
    """
```

```ruby
# @doc docs/auth.md#login-flow
def login(email, password); end
```

Paths are relative to the configured root. An annotation on an unsupported
declaration, or on a TypeScript, JavaScript, Python, or Ruby declaration
excluded by visibility, produces `unsupported_declaration`; the same
declaration without an annotation is ignored. Swift, Dart, Rust, and Go ignore
an annotation on a declaration excluded by visibility without a diagnostic. To link such a declaration, add
its tier to `visibility` where the language accepts one; Dart accepts only
`public`, so a private Dart declaration cannot be linked.

### TypeScript declarations

Supported top-level exported forms include functions, classes, interfaces,
type aliases, enums, and single-declarator variables (`const`, `let`, or
`var`), including supported `declare` and named default forms. Supported members
include class methods, properties, accessors, constructors, and static members;
interface members; and members of object-literal type aliases.

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

### Go declarations

Supported forms are package-level functions, types (including aliases),
constants, and variables, plus receiver methods and interface methods. The
annotation goes in the declaration's doc comment, as `//` lines or one
`/* */` block. Visibility defaults to `exported`; configure `unexported` to
include unexported names. A method counts as exported only when both its name
and its receiver or interface type name are exported. IDs use `.`
qualification without type parameters, such as `AuthService.Login` and
`List.Push` for `func (l *List[T]) Push`.

Inside a `const (`, `var (`, or `type (` group, annotate the individual spec;
an `@doc` in the comment above the group keyword, or above a spec that
declares several names (`var a, b int`), is `unsupported_declaration` because
it cannot name one endpoint. Struct fields, embedded fields, the `package`
clause, imports, `init`, and `_` are not endpoints. The scanner is syntactic:
`_test.go` files and `//go:build`-constrained files are scanned whenever the
patterns match them.

### JavaScript declarations

JavaScript follows the TypeScript rules for the forms an ES module can
express: exported functions, classes, and single-declarator variables, named
default exports, and the members of exported classes, with the same JSDoc
comments and IDs such as `AuthService.login`. Every member is `public`;
`#private` members are not endpoints. CommonJS assignments such as
`module.exports = ...` and `exports.name = ...` are not endpoints, so an
`@doc` on one is `unsupported_declaration`. JSX parses in every JavaScript
file.

### Python declarations

Supported forms are module-level functions and classes, and the methods and
nested classes of a class, including those under `if`, `try`, and `with`
blocks; nothing inside a function body is an endpoint. Put `@doc` in the
docstring or in the `#` comment block directly above the declaration or its
first decorator. IDs are dot-qualified, such as `AuthService.login`. A
property's getter, setter, and deleter share one endpoint, as do `@overload`
stubs and their implementation. A name that starts with `_`, other than a
`__dunder__` name, is `private`, and so is every member of a private class.
Module docstrings, assignments, and nested functions are not endpoints.

### Ruby declarations

Supported forms are classes, modules, constants, instance methods, singleton
methods (`def self.x` and `def x` inside `class << self`), and top-level
methods. Put `@doc` in the `#` comment block directly above the declaration.
IDs use `::` between constants and `.` before a method name, such as
`Auth::Service`, `Auth::MAX_ATTEMPTS`, `Auth::Service.login`, and
`Auth::Service.self.build` for a singleton method. A class reopened in the same
file is one endpoint. Bare `private`, `protected`, and `public` calls,
`private def x`, and `private_class_method` set method visibility; classes,
modules, and constants are always `public`. `attr_reader` and its siblings,
`alias`, and `define_method` are not endpoints.

<!-- @code src/scan/markdown/markdown.ts#scanMarkdown -->

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

<!-- @code src/config/link-manifest.ts#loadLinkManifest -->

## Declare links in a manifest

Some teams do not accept tool-specific markers in their source files. Those
projects can declare every link in an optional root file
`docbridge.links.json` and write no annotation at all. Annotation linking
stays the recommended style, and the two styles work together in one project.

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.links.schema.json",
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

A `code` target whose file is in scope but whose symbol does not exist reports
`code_symbol_not_found` with a `Did you mean` suggestion; this diagnostic is
specific to the manifest. An entry that repeats an existing link, whether from
another entry or from an annotation, reports `duplicate_link`.

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
