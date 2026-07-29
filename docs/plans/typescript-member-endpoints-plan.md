# TypeScript Member Endpoints Plan

This plan addresses [issue #76](https://github.com/salan70/docbridge/issues/76):
TypeScript is the only supported language whose type members cannot be link
endpoints. Swift and Dart both scan members; `src/core/typescript.ts` records
only exported top-level declarations, so a specification section describing one
method has to link to the whole enclosing type. That makes the link coarser than
the specification it represents, which is exactly the condition that makes
semantic review of a link pair unreliable.

This is the last functional asymmetry between the three supported languages. It
was deferred in `docs/plans/done/multilanguage-support-plan.md` pending demand;
the demand is now present in this repository's own dogfooding and in
`teigiii_app`, which scans Dart and TypeScript under one config.

The design rationale — why the canonical ID format is what it is, and why
members are exempt from audit — lives in
[docs/decisions/typescript-member-endpoints.md](../decisions/typescript-member-endpoints.md).
Normative behavior lives in [Scanning](../specs/scanning.md#typescript-scanning),
[Annotations](../specs/annotations.md), and
[Configuration](../specs/configuration.md).

The whole plan lands as a single pull request. Slices are commit units within
that PR, not separate PRs.

## Status

- [x] Slice 1: Member Scanning and Canonical IDs
- [x] Slice 2: TypeScript Visibility Configuration
- [x] Slice 3: Specifications, Decisions, and Fixtures
- [ ] Slice 4: Dogfooding the LSP Specification

## Goals

- `@doc` on an identifier-named class method, class property, getter/setter,
  constructor, interface member, or object type alias member produces a
  resolvable endpoint.
- The canonical ID is derivable by a TypeScript developer reading the source,
  with no parameter signatures, modifiers, or ordinals in it, and it is always
  expressible in the `file#fragment` link grammar.
- `check --audit` output is unchanged for existing projects. Total diagnostics
  are not: an existing `@doc` on a member is collected for the first time and can
  surface a link that was already broken.
- `docbridge context` and `docbridge graph` return the member's own content and
  JSDoc, dedented, rather than the enclosing type's.
- This repository links `docs/specs/lsp.md` sections to the `Server` handlers
  that implement them, and `just verify` passes.

## Non-Goals

- Adding a language, or changing the Swift or Dart canonical ID format.
- Changing the `file#fragment` link target grammar in `src/core/links.ts`.
- Namespace members, module augmentation, and declaration merging.
- Object-literal properties as endpoints (`export const x = { foo() {} }`).
- Members of union, intersection, mapped, or conditional type aliases.
- Enum members, index signatures, and call/construct signatures.
- Members whose name is not a plain identifier: string-literal, numeric,
  computed, and private-identifier (`#secret`) names.
- Constructor parameter properties (`constructor(private readonly x: T) {}`).
- Anonymous default-exported classes as member containers; they are not
  endpoints today either.
- Detecting `@doc` comments that are not attached to a top-level declaration or
  one of its direct members. `docs/specs/annotations.md` already documents that
  orphan `@doc` comments are not detected; that limitation is unchanged.
- New diagnostic codes. See [Diagnostics Reuse](#diagnostics-reuse).

## Decisions

Full rationale is in the decisions document. Summarised here so the slices read
without a second file open.

### Canonical IDs Carry No Parameters and Stay Inside the Link Grammar

A member endpoint is `Type.member`. Only identifier-named members qualify: a
link target is split on `#` into exactly two parts and its fragment may not
contain whitespace (`src/core/links.ts:30`), so `Type.#secret` and
`Type."space name"` are not expressible and are not endpoints.

TypeScript overloads are multiple signatures
of one implementation and always share a name within a type, so an overload
group collapses to one endpoint — the existing "documented when any declaration
carries `@doc`" rule in `scanTypeScript` already implements this. Parameter
types in the ID would break on every refactor and require normalising unions,
generics, and `import()` types; ordinals would depend on declaration order.

### Object Type Aliases Are Members Too

`interface X {}` and `type X = {}` are interchangeable as a public surface in
TypeScript. Supporting one and not the other would replace the asymmetry this
issue closes with a new one. Measured in this repository: 0 interfaces, 77
exported object type aliases, 3 classes. Only a type alias whose type is
_directly_ an object type literal is in scope.

The container segment is the exported binding name, so `export const Public =
class Internal { … }` yields `Public.member`, and an anonymous default-exported
class has no container at all. "`const`" here follows the code rather than the
specification's current wording: `src/core/typescript.ts:314` accepts any
exported single-declarator variable statement regardless of `const`, `let`, or
`var`, so `docs/specs/scanning.md` is corrected alongside.

### Members Are Exempt From Audit

A member appears in `CodeScanResult.symbols` only when it carries `@doc`, and
never in `undocumentedSymbols`. Being linkable and being required to be
documented are different properties, and only the former is what #76 asks for.
Measured, member scanning would grow this repository's audit symbol set from 195
to 468 — a 2.4x jump in `undocumented_symbol` warnings for every existing
`--audit` user. Restrictive-to-permissive is additive later; the reverse is a
breaking change.

### Collisions Are Diagnosed, Not Encoded

Static and instance members of the same name, and getter/setter pairs, share one
canonical ID. When exactly one carries `@doc` the link resolves; when both do,
`duplicate_code_symbol` fires. The scanner still emits the first annotated
declaration and its links (`src/core/typescript.ts:133`), so navigation lands on
it; what makes that acceptable is that the diagnostic is an **error** and
`docbridge check` fails until the collision is resolved.

TypeScript's `get`/`set` pair is one property from the consumer's perspective,
unlike Dart's separate library members, so it does not take Dart's trailing `=`.
The constructor is `Type.constructor`, matching the keyword in the source,
because canonical IDs are hand-written in Markdown and must be guessable from
the code.

### Visibility Is Configurable, Default Restrictive

`include.code.typescript.visibility` accepts `public`, `protected`, and
`private`, defaulting to `["public", "protected"]`. TypeScript already has a
visibility rule — top-level declarations must be exported — and this extends it
rather than inventing one. Swift already exposes the same knob, so adding it
reduces the configuration asymmetry. The default leaves existing behavior
unchanged; this repository opts into `private` for Slice 4.

### Diagnostics Reuse

This change adds no diagnostic codes:

| Situation                                                            | Existing code             |
| -------------------------------------------------------------------- | ------------------------- |
| `@doc` on an out-of-scope member                                     | `unsupported_declaration` |
| Static/instance, get/set, or overload collision with two `@doc` tags | `duplicate_code_symbol`   |
| `@code` naming a member with no reciprocal `@doc`                    | `code_backlink_not_found` |

## Slice 1: Member Scanning and Canonical IDs

Descend one level from every top-level `class`, `interface`, `enum`, object type
alias, and class-expression variable statement — exported or not, so that an
annotated member of a non-exported class is diagnosed the same way an annotated
non-exported top-level declaration already is. `enum` is visited only to make
`unsupported_declaration` reachable on its members; enum members never become
endpoints.

Recorded members, identifier-named only:

- class: methods, properties, getters, setters, constructors, static members
- interface: property and method signatures
- object type alias: property and method signatures

Annotated but rejected, each producing `unsupported_declaration`: non-identifier
names, index signatures, call and construct signatures, enum members, parameter
properties, and members excluded by visibility. The default scope
(`public` and `protected`) ships here rather than in Slice 2, so no commit
leaves `private` members addressable; Slice 2 only makes the scope
configurable.

`signatureRange` includes the leading JSDoc and excludes the implementation body;
members without a body use the whole declaration. Ranges keep the declaration's
true start position — the earlier idea of forcing `start.column` to `1` is
rejected, because for `class C { /** @doc … */ method() {} }` it drags `class C {`
into the member's content and because it leaves `signatureRange` ragged.

Where an overload group or a `get`/`set` pair collapses, the ranges come from the
first `@doc`-annotated declaration, which is what the existing endpoint dedup
loop already selects.

Dedent extracted content in both extractors instead: `src/core/context.ts:250`
and `src/core/graph-output.ts:328` strip the block's common leading indentation.
This is a no-op for every existing top-level endpoint.

Update the `unsupported_declaration` message to enumerate members.

Verification:

```sh
just test
just typecheck
```

Done when:

- `src/core/typescript.test.ts` covers each member kind, each rejection case, the
  collapse cases, and the collision cases, all written test-first.
- `src/core/context.test.ts` and the graph tests cover dedenting, including the
  single-line class body, and show unchanged output for top-level declarations.

## Slice 2: TypeScript Visibility Configuration

Add `typescript: ["public", "protected", "private"]` to the allowed visibility
values in `src/core/config.ts:45` and thread the resolved option into
`typeScriptAdapter.scanFile`, which currently ignores `CodeScanOptions`. Default
to `["public", "protected"]` when unset.

Members excluded by visibility are not endpoints; an excluded member carrying
`@doc` gets `unsupported_declaration`.

Verification:

```sh
just test
```

Done when:

- Config validation rejects unknown TypeScript visibility values through the
  existing mechanism, and a `private`-only fixture flips behavior with the
  setting.

## Slice 3: Specifications, Decisions, and Fixtures

`src/core/typescript.ts#scanTypeScript` is annotated
`@doc docs/specs/scanning.md#typescript-scanning`, so the related gate requires
the specification to move with the scanner.

- `docs/specs/scanning.md`: TypeScript member scanning, supported containers,
  canonical ID format, and visibility, written to sit alongside the existing
  Swift and Dart sections.
- `docs/specs/annotations.md`: a TypeScript member `@code` backlink example
  matching the Swift and Dart examples.
- `docs/specs/configuration.md`: the new visibility key.
- `docs/specs/diagnostics.md`: the reworded `unsupported_declaration`.
- `docs/specs/scanning.md`: correct "supported `const` initializers" to
  "single-declarator exported variable statement", which is what
  `src/core/typescript.ts:314` has always implemented.
- `CHANGELOG.md`: note that a previously ignored `@doc` on a member now
  resolves, so existing projects can see link diagnostics they did not see
  before.
- `docs/decisions/typescript-member-endpoints.md`: the rationale, including the
  rejected canonical ID alternatives and why the audit exemption and the
  restrictive default are the safe direction.
- `test-fixtures/diagnostics/unsupported_declaration/`: a `@doc` on a `private`
  member.
- `test-fixtures/diagnostics/duplicate_code_symbol/`: a static/instance or
  get/set collision with both declarations annotated.
- `examples/typescript`: one member link pair, as the copyable showcase.

Verification:

```sh
just check
just check-fixture unsupported_declaration
just check-fixture duplicate_code_symbol
just check-example
```

Done when:

- Every fixture fires exactly its own diagnostic, and the specification
  describes TypeScript members at the same level of detail as Swift and Dart.

## Slice 4: Dogfooding the LSP Specification

`docs/specs/lsp.md` has per-feature sections whose implementations are the
`Server` handlers, which are `private`. Set
`include.code.typescript.visibility` to include `private` in this repository's
`docbridge.config.json`, then link:

| Specification section             | Member                                          |
| --------------------------------- | ----------------------------------------------- |
| `lsp.md#hover`                    | `Server.onHover`                                |
| `lsp.md#definition`               | `Server.onDefinition`                           |
| `lsp.md#references`               | `Server.onReferences`                           |
| `lsp.md#document-synchronization` | `Server.onDidOpen`, `onDidChange`, `onDidClose` |
| `lsp.md#diagnostics`              | `Server.flush`                                  |

The exact set is settled during the slice; what matters is that the links are at
the specification's own granularity rather than pointing at `Server` or
`Server.handle`.

- Check the final `## Status` box and `git mv` this plan into `docs/plans/done/`
  in the same change.

Verification:

```sh
just verify
```

Done when:

- `docbridge context docs/specs/lsp.md` returns individual handler bodies, and
  the repository's own audit output is unchanged apart from the new links.

## Follow-up Work

- Object-literal properties as endpoints, if adopters ask for the
  `export const service = { ... }` shape.
- Members of union and mapped type aliases.
- Constructor parameter properties, which need a rule for whether the property
  and the constructor are one endpoint or two.
- Non-identifier member names, which need an escaping scheme in the
  `file#fragment` grammar and therefore a cross-language decision.
- Whole-file `@doc` detection, which would close the orphan-annotation gap
  documented in `docs/specs/annotations.md` for every language at once.
- Including members in `--audit` behind a configuration key, once anyone wants
  member documentation coverage measured.
