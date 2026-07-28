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

- [ ] Slice 1: Member Scanning and Canonical IDs
- [ ] Slice 2: TypeScript Visibility Configuration
- [ ] Slice 3: Specifications, Decisions, and Fixtures
- [ ] Slice 4: Dogfooding the LSP Specification

## Goals

- `@doc` on a class method, class property, getter/setter, constructor,
  interface member, or object type alias member produces a resolvable endpoint.
- The canonical ID is derivable by a TypeScript developer reading the source,
  with no parameter signatures, modifiers, or ordinals in it.
- Existing projects see no new diagnostics and no change in `check --audit`
  output from this change alone.
- `docbridge context` returns the member's own content and JSDoc, correctly
  indented, rather than the enclosing type's.
- This repository links `docs/specs/lsp.md` sections to the `Server` handlers
  that implement them, and `just verify` passes.

## Non-Goals

- Adding a language, or changing the Swift or Dart canonical ID format.
- Namespace members, module augmentation, and declaration merging.
- Object-literal properties as endpoints (`export const x = { foo() {} }`).
- Members of union, intersection, mapped, or conditional type aliases.
- Enum members, index signatures, and call/construct signatures.
- Detecting `@doc` comments that are not attached to a top-level declaration or
  one of its direct members. `docs/specs/annotations.md` already documents that
  orphan `@doc` comments are not detected; that limitation is unchanged.
- New diagnostic codes. See [Diagnostics Reuse](#diagnostics-reuse).

## Decisions

Full rationale is in the decisions document. Summarised here so the slices read
without a second file open.

### Canonical IDs Carry No Parameters

A member endpoint is `Type.member`. TypeScript overloads are multiple signatures
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
`duplicate_code_symbol` fires. TypeScript's `get`/`set` pair is one property from
the consumer's perspective, unlike Dart's separate library members, so it does
not take Dart's trailing `=`. The constructor is `Type.constructor`, matching the
keyword in the source, because canonical IDs are hand-written in Markdown and
must be guessable from the code.

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

Descend one level from every top-level `class`, `interface`, object type alias,
and class-expression `const` — exported or not, so that an annotated member of a
non-exported class is diagnosed the same way an annotated non-exported top-level
declaration already is.

Recorded members:

- class: methods, properties, getters, setters, constructors, static members
- interface: property and method signatures
- object type alias: property and method signatures

Ranges follow the top-level rules with one addition: a member's
`declarationRange.start.column` is fixed to `1`. `src/core/context.ts:250-268`
slices only the first line by `start.column`, so an indented member would
otherwise come back with its first line dedented and the rest indented.
`signatureRange` includes the leading JSDoc and excludes the implementation
body; members without a body use the whole declaration.

Where an overload group or a `get`/`set` pair collapses, the ranges come from
the first `@doc`-annotated declaration, which is what the existing endpoint
dedup loop already selects.

Update the `unsupported_declaration` message to enumerate members.

Verification:

```sh
just test
just typecheck
```

Done when:

- `src/core/typescript.test.ts` covers each member kind, the collapse cases, the
  collision cases, and the indentation fix, all written test-first.

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

- Object-literal `const` properties as endpoints, if adopters ask for the
  `export const service = { ... }` shape.
- Members of union and mapped type aliases.
- Whole-file `@doc` detection, which would close the orphan-annotation gap
  documented in `docs/specs/annotations.md` for every language at once.
- Including members in `--audit` behind a configuration key, once anyone wants
  member documentation coverage measured.
