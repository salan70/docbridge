# TypeScript Member Endpoints

This document records why TypeScript member endpoints are shaped the way they
are. It is not normative: the behavior itself is specified in
[Scanning](../specs/scanning.md#typescript-scanning),
[Annotations](../specs/annotations.md), and
[Configuration](../specs/configuration.md). Implementation sequencing lives in
[the plan](../plans/typescript-member-endpoints-plan.md).

The trigger is [issue #76](https://github.com/salan70/docbridge/issues/76).
Swift and Dart scan type members; TypeScript scanned only exported top-level
declarations, so a specification section describing one method could only link
to the enclosing type.

Canonical IDs are the reason this needs a decision record rather than only a
specification. They are written by hand inside `@doc` and `@code` annotations in
other people's repositories, so the format is a compatibility surface from the
first release that ships it. Changing it later invalidates annotations DocBridge
does not own.

## Canonical IDs Carry No Parameters

**Decision.** A member endpoint is `Type.member`. No parameter types, no
modifiers, no ordinals.

The premise in issue #76 was that TypeScript sits awkwardly between the other
two languages: it has overloads, unlike Dart, and no argument labels, unlike
Swift. That framing overstates the problem. A TypeScript overload group is
several signatures of a single implementation, always sharing one name within
one type. Splitting it into several endpoints would let a specification section
link to one signature of a function that cannot be called or reviewed
independently of its siblings.

So overloads are not an ambiguity problem at all. They collapse to one endpoint,
and `scanTypeScript` already had the machinery for it: the existing rule is that
an endpoint is documented when any of its declarations carries `@doc`, and two
annotated declarations of one endpoint produce `duplicate_code_symbol`. That
rule was written for top-level function overloads and extends to members
unchanged.

Rejected alternatives:

- **Parameter types in the ID** (`AuthService.login(string,string)`). Requires
  normalising unions, generics, and `import()` types into a stable textual form,
  and breaks every annotation whenever a parameter type changes. The ID would
  encode implementation detail into a link meant to survive refactoring.
- **Overload ordinals** (`AuthService.login#1`). Depends on declaration order, so
  reordering two signatures silently repoints every link.

## Object Type Aliases Are Member Containers

**Decision.** Members of `class`, `interface`, an object type alias whose type is
directly an object type literal, and a class expression assigned to a supported
`const` are all endpoints.

Issue #76's acceptance criteria named only classes and interfaces. Measuring this
repository showed why that set is wrong:

| Declaration form          | Count in `src/` |
| ------------------------- | --------------- |
| `export interface`        | 0               |
| `export type X = { ... }` | 77              |
| `export class`            | 3               |

`interface X {}` and `type X = {}` are interchangeable as a public surface in
TypeScript, and their members are the same AST node kinds. Supporting one and
not the other would close the cross-language asymmetry #76 exists to fix while
opening a within-language one — and would have left the issue's own dogfooding
criterion satisfiable only in name.

Union, intersection, mapped, and conditional type aliases stay out: a member's
provenance is ambiguous when the type is composed rather than written out.
Object-literal `const` properties stay out as the issue specified; the "supported
`const` initializers" phrasing in its proposed scope is read as class
expressions, which the scanner already special-cases when computing
`signatureRange`.

## Members Are Exempt From Audit

**Decision.** A member enters `CodeScanResult.symbols` only when it carries
`@doc`, and never enters `undocumentedSymbols`.

Issue #76 flagged the risk that member scanning turns a quiet `check --audit`
into a noisy one. Measured on this repository, the audit symbol set would grow
from 195 endpoints to 468 — a 2.4x increase in `undocumented_symbol` warnings for
every existing `--audit` user, arriving in a release they installed for an
unrelated reason.

The separation is cheap because `CodeScanResult` already distinguishes the two
sets, and `undocumentedSymbols` has exactly one consumer: the `undocumented_symbol`
rule in `src/core/resolver.ts`.

It is also conceptually right. "Can be a link target" and "must be documented"
are different properties, and #76 asks only for the first. Requiring a `@doc` on
every property of every exported type is not what the tool is for.

This costs the ability to measure member documentation coverage. That is
recoverable: a configuration key can add members to audit later, additively.
Shipping the noisy behavior first and narrowing it afterwards would be a breaking
change, so the restrictive direction is the only safe one to start from.

## Collisions Are Diagnosed, Not Encoded

**Decision.** Static and instance members of the same name share one canonical
ID, as do getter/setter pairs. When two of them carry `@doc`,
`duplicate_code_symbol` fires.

TypeScript permits `class A { static create() {} create() {} }`. Encoding the
distinction — `A.static.create`, `A::create` — would make every ID in every
repository carry a marker for a case that is rare in practice. Sharing the ID
costs nothing when only one member is annotated, which is the normal case, and
produces a diagnostic rather than an arbitrary match when both are. That is
exactly what issue #76's acceptance criterion asks for.

A `get`/`set` pair collapses to one endpoint without Dart's trailing `=`. Dart's
getters and setters are separate library members; TypeScript's are two
declarations of one property, indistinguishable at the use site. Copying Dart's
notation would import a distinction the language does not make.

The constructor is `Type.constructor`, not Dart's `Type.new` or Swift's
`Type.init`. Because canonical IDs are hand-written in Markdown, the governing
principle is that a developer reading the source can guess the ID. A TypeScript
developer looking at `constructor(...)` has no reason to write `new`.

## Visibility Is Configurable, Default Restrictive

**Decision.** `include.code.typescript.visibility` accepts `public`, `protected`,
and `private`, defaulting to `["public", "protected"]`.

TypeScript already had an unstated visibility rule: top-level declarations are
endpoints only when exported, and an annotated non-exported declaration produces
`unsupported_declaration`. Extending that to members means excluding `private`
and `#private` by default. `protected` is included because it is part of the
contract a subclass programs against.

The initial position was a fixed rule with no configuration key, on the grounds
that `private` is unambiguously internal and that no external demand existed.
Examining this repository's LSP layer reversed that. `docs/specs/lsp.md` has
per-feature sections — Hover, Definition, References, Diagnostics, Document
synchronization — and every handler implementing them is `private` on `Server`.
Its only public members are `handle` and the constructor. Under a fixed rule,
this repository's most precisely matched specification-to-code links would be
unwritable, and `lsp.md#hover` would have to point at either the whole `Server`
class or the shared entry point for all LSP methods: the coarseness #76 exists
to remove.

A configuration key resolves this without giving up the safe default. It also
reduces asymmetry rather than adding it, since `include.code.swift.visibility`
already exists and TypeScript was the language missing the knob. The default
leaves every existing project's behavior unchanged, and this repository opts into
`private` explicitly.

## No New Diagnostic Codes

**Decision.** Member support reuses existing codes.

| Situation                                                                                                                     | Code                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `@doc` on an out-of-scope member — `private` under the default, an enum member, an index signature, a union type alias member | `unsupported_declaration` |
| Two `@doc` tags on one canonical ID — overloads, static/instance, get/set                                                     | `duplicate_code_symbol`   |
| `@code` naming a member with no reciprocal `@doc`                                                                             | `code_backlink_not_found` |

DocBridge has no `code_symbol_not_found`; `@code` targets are validated by the
presence of a reciprocal `@doc`. That is why exempting members from audit opens
no hole in `@code` resolution — the same bidirectional-pair requirement that
already governs top-level endpoints governs members.

Scanning descends one level into every top-level container, exported or not, so
that an annotated member of a non-exported class is diagnosed the same way an
annotated non-exported top-level declaration already is. It does not walk whole
files. `docs/specs/annotations.md` documents that `@doc` comments not associated
with a declaration go undetected; changing that is a separate, all-language
concern, and doing it here would emit new warnings across code regions this
feature has no stake in.
