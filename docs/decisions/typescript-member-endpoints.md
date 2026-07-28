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
  reordering two signatures silently repoints every link. It is also
  unrepresentable: a link target is split on `#` and must yield exactly two
  parts (`src/core/links.ts:30`).

## Only Identifier-Named Members Are Endpoints

**Decision.** A member is an endpoint only when its name is a plain identifier.
String-literal names, numeric names, computed names, and private identifiers
(`#secret`) are not endpoints; an annotated one produces
`unsupported_declaration`.

The link target grammar is the constraint. `parseLinkTarget` splits the raw
target on `#` and rejects anything that does not yield exactly two parts
(`src/core/links.ts:30`), and a fragment may not contain whitespace
(`isValidTargetFragment`). So a private identifier member is not merely awkward
to encode — `src/auth.ts#AuthService.#secret` is syntactically invalid, and
dropping the `#` collides with a sibling named `secret`. A member named
`"space name"` is equally unrepresentable.

The alternative is an escaping or quoting scheme inside the fragment. That
changes `file#fragment`, which is the one grammar shared by every language
DocBridge supports and by every annotation already written in adopter
repositories. Paying that price so that a `#private` member can be linked — a
member that is unreachable from outside its class, and whose specification
section would more usefully point at whatever exposes it — is a bad trade.

This makes `private secret` linkable under the `private` visibility opt-in while
`#secret` is not. The asymmetry is real and is accepted: the two are different
language constructs, and only one of them collides with the link grammar.

## Object Type Aliases Are Member Containers

**Decision.** Members of `class`, `interface`, an object type alias whose type is
directly an object type literal, and a class expression assigned to a supported
variable statement are all endpoints.

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
Object-literal properties of a variable initializer stay out as the issue
specified; the "supported `const` initializers" phrasing in its proposed scope is
read as class expressions, which the scanner already special-cases when computing
`signatureRange`.

"`const`" is the issue's word and the specification's, but not the code's. The
scanner accepts any exported single-declarator variable statement without
inspecting the declaration list flags (`src/core/typescript.ts:314`), and the
class-expression signature special case is likewise flag-blind
(`src/core/typescript.ts:391`). So `export let C = class { … }` is already a
top-level endpoint today. Member scanning follows the code rather than the
specification's wording, and `docs/specs/scanning.md` is corrected to say
"single-declarator exported variable statement". Implementing `const`-only
containers would have given the same declaration an endpoint at the top level and
no members.

### Container Names Must Exist and Be Unambiguous

A container contributes the `Type` segment of every member ID, so a container
without a usable name is not a container. An anonymous default-exported class has
no name and is already rejected as a top-level endpoint
(`src/core/typescript.ts:295`); it gains no members here.

For `export const Public = class Internal { … }` the ID is `Public.member`. The
exported binding is what the rest of the program can name, and it is already the
top-level endpoint for that declaration; deriving members from `Internal` would
produce IDs whose container segment appears nowhere in the module's public
surface and does not match its own enclosing endpoint.

### Constructor Parameter Properties Are Out of Scope

TypeScript's `constructor(private readonly root: string) {}` declares a class
property from a `ParameterDeclaration` nested under the constructor, not from a
direct class element, and it carries JSDoc. `src/lsp/project.ts:39` in this
repository uses the form.

Supporting it means descending a second level for one syntactic special case, and
it raises a question this design does not otherwise have to answer: whether the
parameter property and the constructor are one endpoint or two. It is excluded
for now, and an annotated parameter property produces `unsupported_declaration`
rather than being silently ignored, so the limit is visible to whoever hits it.

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
costs nothing when only one member is annotated, which is the normal case.

What happens when both are annotated is worth stating precisely, because the
scanner does not stop resolving. It emits the first annotated declaration as the
symbol along with its links, then diagnoses and skips the second
(`src/core/typescript.ts:133`), and the graph keeps the first occurrence
(`src/core/graph.ts:19`). So `context` and LSP navigation still land on the
declaration that appears first in the file. What prevents this from being an
arbitrary match in practice is that `duplicate_code_symbol` is an **error**:
`docbridge check` fails, and the collision has to be resolved before the state
can be committed under any of the repository's gates. The guarantee is "the build
stops", not "nothing resolves".

A `get`/`set` pair collapses to one endpoint without Dart's trailing `=`. Dart's
getters and setters are separate library members; TypeScript's are two
declarations of one property, indistinguishable at the use site. Copying Dart's
notation would import a distinction the language does not make.

The constructor is `Type.constructor`, not Dart's `Type.new` or Swift's
`Type.init`. Because canonical IDs are hand-written in Markdown, the governing
principle is that a developer reading the source can guess the ID. A TypeScript
developer looking at `constructor(...)` has no reason to write `new`.

## Extracted Content Is Dedented by the Extractors

**Decision.** Member ranges keep the declaration's true start position, and the
two content extractors strip the block's common leading indentation.

Content extraction slices only the first line by `start.column` and leaves the
remaining lines untouched (`src/core/context.ts:250`). Every top-level
declaration starts at column 1, so this has never mattered; an indented member
would come back with its first line dedented and its body still indented.

The first attempt at a fix was to force a member's
`declarationRange.start.column` to `1`, which needs no change outside the
scanner. It is wrong in two ways. For `class C { /** @doc … */ method() {} }` the
member's start line is the class's start line, so the extracted content picks up
`class C {` — the enclosing declaration, which is precisely what member endpoints
exist to avoid returning. And it treats only `declarationRange`; graph content
uses `signatureRange` through the same first-line-only slicing
(`src/core/graph-output.ts:328`), so multiline member signatures stay ragged
there.

Dedenting in the extractors fixes both, keeps ranges honest as source
coordinates, and is a no-op for every existing top-level endpoint, whose common
indentation is zero.

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

| Situation                                                                                                                                                                                 | Code                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `@doc` on a visited but out-of-scope member — `private` under the default, a non-identifier name, an index signature, a call or construct signature, an enum member, a parameter property | `unsupported_declaration` |
| Two `@doc` tags on one canonical ID — overloads, static/instance, get/set                                                                                                                 | `duplicate_code_symbol`   |
| `@code` naming a member with no reciprocal `@doc`                                                                                                                                         | `code_backlink_not_found` |

DocBridge has no `code_symbol_not_found`; `@code` targets are validated by the
presence of a reciprocal `@doc`. That is why exempting members from audit opens
no hole in `@code` resolution — the same bidirectional-pair requirement that
already governs top-level endpoints governs members.

### What Is Visited Versus What Is Diagnosed

Scanning descends one level into every top-level `class`, `interface`, `enum`,
object type alias, and class-expression variable statement, exported or not, so
that an annotated member of a non-exported class is diagnosed the same way an
annotated non-exported top-level declaration already is. `enum` is visited even
though enum members are never endpoints, because the visit is what makes
`unsupported_declaration` reachable and the statement is already in the top-level
loop.

Everything not on that list is invisible rather than diagnosed. An annotated
property inside a union or mapped type alias sits below the alias's direct type,
and an annotated member of a class nested in a function body or a namespace is
below the top-level statement, so neither is collected at all. Claiming a
diagnostic for those would be false: `collectDocTags` runs per top-level
statement (`src/core/typescript.ts:74`), and reaching them means walking whole
files.

Whole-file traversal is deliberately not attempted here.
`docs/specs/annotations.md` documents that `@doc` comments not associated with a
declaration go undetected. Changing that is a separate, all-language concern, and
doing it inside this feature would emit new warnings across code regions this
feature has no stake in.

### Audit Output Is Unchanged; Total Diagnostics Are Not

The compatibility guarantee is narrower than "no new diagnostics", and stating it
loosely would be wrong.

`check --audit` output is genuinely unchanged, because members never enter
`undocumentedSymbols`. But a `@doc` sitting on a public class member in an
existing project is ignored today and becomes a real link after this change. That
link then goes through ordinary resolution and can produce `invalid_link_target`,
`doc_file_not_found`, `doc_anchor_not_found`, or `doc_backlink_not_found`
(`src/core/resolver.ts:81`). An existing annotation on a `private` member becomes
`unsupported_declaration`.

Every one of those reports a link that was already broken and previously
invisible, which is the point of the feature. It is still a behavior change for
existing projects and belongs in the release notes.
