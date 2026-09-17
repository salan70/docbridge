# Link Manifest Plan

This plan implements [issue #143](https://github.com/salan70/docbridge/issues/143):
an optional root file `docbridge.links.json` declares links with no marker in
code or Markdown, so a team that does not accept tool-specific comments in
source files can still adopt DocBridge.

Normative behavior lands in [Link manifest](../specs/link-manifest.md), with
supporting changes in [Link resolution](../specs/link-resolution.md),
[Scanning](../specs/scanning.md), and [Diagnostics](../specs/diagnostics.md).

The whole plan lands as a single pull request. Slices are commit units within
that PR, not separate PRs.

## Status

- [ ] Slice 1: Position-tracking JSON reader
- [ ] Slice 2: Shared nearest-match helper
- [ ] Slice 3: Member endpoints in the audit symbol set
- [ ] Slice 4: Manifest loading and schema
- [ ] Slice 5: Manifest application and `code_symbol_not_found`
- [ ] Slice 6: Command surfaces and member targets in four languages
- [ ] Slice 7: User documentation and example

## Goals

- A project with `docbridge.links.json` and zero annotations passes
  `docbridge check`, and `graph --json` reports each entry as a bidirectional
  pair.
- A manifest entry can target a type member in all four supported languages.
- A renamed symbol produces `code_symbol_not_found` at the manifest entry's
  line and column, with a `Did you mean` suggestion.
- `related --gate` and `context` report manifest-linked counterparts.
- `check --audit` output is unchanged for every language.

## Non-Goals

- Changing the `file#fragment` grammar or the annotation styles.
- LSP features anchored on the manifest file, such as code lens. Navigation
  from a linked endpoint works through the existing graph and is specified as
  such.
- `docbridge init` support, `docbridge` skill changes, and candidate entry
  generation from `--audit` output.
- Multiple manifest files or a configurable manifest path.
- Surfacing `note` in any command output.

## Decisions

### Manifest Links Are Applied As Ordinary Annotations

`scanProject` in `src/core/project-scan.ts` is the single funnel for `check`,
`related`, `context`, `graph`, and the language server. Loading the manifest
there and turning each entry into the two `LinkAnnotation` values an annotation
pair would have produced leaves the resolver, the graph builder, and every
command unchanged. The annotation's `location` is the manifest entry, so
diagnostics point at the manifest.

This also decides where the pair semantics come from: the resolver requires
both directions, and the applier supplies both, so no backlink diagnostic can
fire for a manifest link.

### The Member Exemption Is One Scanner, Not Four

Issue #143 assumed all four scanners withhold type members from
`undocumentedSymbols`, and proposed worker protocol `schemaVersion` 2 to move
the exemption into the resolver. Only `src/core/typescript.ts` withholds them.
The Swift, Dart, and Rust workers already report members there, which
`packages/rust-scanner/tests/scanner_tests.rs` asserts directly.

So protocol v2 would not unify anything. It would newly suppress member
`undocumented_symbol` warnings for three languages, which the issue does not
ask for, and it would require rebuilding three native workers.

Instead, `CodeSymbolEndpoint` gains an optional `isMember` flag,
`schemaVersion` stays 1, and the native workers are untouched. The TypeScript
scanner reports members with `isMember: true`, and the `undocumented_symbol`
rule skips flagged symbols. A manifest entry can then resolve a member in every
language from `symbols` plus `undocumentedSymbols`, and audit output does not
move. A cross-language member audit policy is left as follow-up work.

This makes the claim in
[TypeScript member endpoints](../decisions/typescript-member-endpoints.md) that
a member "never enters `undocumentedSymbols`" inaccurate at the data-structure
level, so that document is amended rather than left to rot.

### Shape Errors Stop Scanning; Target Errors Skip One Entry

A manifest that cannot be parsed, or whose shape is wrong, reports a `config_*`
diagnostic targeting `docbridge.links.json` and stops scanning, the way a bad
`docbridge.config.json` does. Those failures make the whole declared link set
untrustworthy.

A `code` or `doc` value that fails the `file#fragment` grammar is a per-entry
authoring mistake. It reports `invalid_link_target` at the value and skips that
entry, so one typo does not hide every other entry's diagnostics. This matches
how a malformed annotation behaves.

### An Attempted Link Counts For Audit

When the code endpoint of an entry resolves, its symbol is treated as
documented even if the doc side fails; when the anchor resolves, its heading is
treated as annotated even if the code side fails. Both failures already produce
their own error. Reporting `undocumented_symbol` or `unlinked_doc_section` on
top would describe a link the author did write, and `unlinked_doc_section`
would additionally collapse the surrounding subtree into one roll-up. This is
the rule `hasCodeAnnotation` already applies to a broken `@code` comment.

### Diagnostics Reuse

| Situation                                            | Code                                        |
| ---------------------------------------------------- | ------------------------------------------- |
| Manifest unreadable or unparsable                    | `config_file_invalid`                       |
| Unknown key, at the top level or inside an entry     | `config_unknown_key`                        |
| Wrong shape or wrong value type                      | `config_invalid_value`                      |
| `code` or `doc` violates the target grammar          | `invalid_link_target`                       |
| Entry duplicates an annotation pair or another entry | `duplicate_link`                            |
| Code or doc file outside the managed set             | `code_file_not_found`, `doc_file_not_found` |
| Anchor missing from an existing doc file             | `doc_anchor_not_found`                      |

One code is new. `code_symbol_not_found` reports a `code` target whose file is
in scope but whose canonical ID does not exist. The case cannot arise from
`@doc`, which sits on the declaration itself.

## Slice 1: Position-Tracking JSON Reader

`src/core/json-source.ts` parses RFC 8259 into a node tree carrying the 1-based
line and column of every value and object key, plus the content range of each
string excluding its quotes. `JSON.parse` reports no usable position, and the
manifest needs one per entry.

Accepted input matches `JSON.parse` exactly, which the tests assert in both
directions over a corpus.

Verification:

```sh
just test
just typecheck
```

Done when `src/core/json-source.test.ts` covers value parity with `JSON.parse`,
key and value ranges, string content ranges with escapes, CRLF line counting,
UTF-16 columns, and a located error for each rejected form.

## Slice 2: Shared Nearest-Match Helper

`src/cli/index.ts` holds a private `nearestSubcommand` and `editDistance` used
for `Did you mean` on an unknown subcommand. `code_symbol_not_found` needs the
same suggestion from `src/core/`, which cannot import the CLI layer.

Move the helper to `src/core/suggest.ts` as `nearestMatch`, keeping the
ordered-abbreviation preference and the distance threshold, and have the CLI
call it.

Verification:

```sh
just test
```

Done when the CLI's unknown-subcommand behavior is unchanged and
`src/core/suggest.test.ts` pins the selection rules.

## Slice 3: Member Endpoints in the Audit Symbol Set

Add optional `isMember` to `CodeSymbolEndpoint` and to `codeSymbol` in
`schemas/scanner-worker.schema.json`. `src/core/typescript.ts` reports
undocumented members with the flag set, and `auditUndocumentedSymbols` in
`src/core/resolver.ts` skips flagged symbols.

Reword the member paragraph in [Scanning](../specs/scanning.md) and amend
[TypeScript member endpoints](../decisions/typescript-member-endpoints.md).

Verification:

```sh
just test
just check-audit-baseline
```

Done when the audit baseline is unchanged and the TypeScript scanner test that
asserted members are absent from `undocumentedSymbols` asserts the flag
instead.

## Slice 4: Manifest Loading and Schema

`src/core/link-manifest.ts` exposes `LINK_MANIFEST_FILE_NAME`,
`loadLinkManifest` for the filesystem, and a pure `resolveLinkManifest` for the
text. An absent file yields an empty manifest and no diagnostic.

Add `schemas/docbridge.links.schema.json` and validate it in tests the way the
configuration schema is validated.

Verification:

```sh
just test
```

Done when every shape error reports its code, its manifest target, and its
position, and a grammar error reports `invalid_link_target` without stopping
the load.

## Slice 5: Manifest Application and `code_symbol_not_found`

`src/core/link-manifest-apply.ts` turns entries into links. It returns new scan
results rather than mutating its input, so the applier can be tested in
isolation and the scan pipeline stays a chain of values.

`collectErroredFiles` moves from `src/core/resolver.ts` to
`src/core/diagnostics.ts` to keep the import graph acyclic.

Add `code_symbol_not_found` to the diagnostic union, the diagnostics
specification, the troubleshooting guides, and
`test-fixtures/diagnostics/code_symbol_not_found/`.

Verification:

```sh
just verify
just check-fixture code_symbol_not_found
just check-audit-baseline
```

Done when a manifest-only project passes `check`, each failure mode reports at
the right position, and the applier leaves its inputs untouched.

## Slice 6: Command Surfaces and Member Targets in Four Languages

Cover `graph --json`, `related --gate`, and `context` against a manifest-only
project, and add one member-targeting manifest entry to each of the Swift,
Dart, and Rust integration tests.

Verification:

```sh
just test
```

Done when each command reports manifest links the way it reports annotation
links, and a member target resolves in all four languages.

## Slice 7: User Documentation and Example

Document the manifest in [Linking](../user/linking.md) and its Japanese
counterpart, add the `code_symbol_not_found` row to both troubleshooting
guides, and add one manifest-declared pair to `examples/typescript` so the
showcase demonstrates coexistence.

Check the final `## Status` box and `git mv` this plan into `docs/plans/done/`
in the same change.

Verification:

```sh
just verify
just check-example
```

Done when the example project passes with one annotation pair and one manifest
pair, and both language versions of the linking guide describe the manifest.

## Follow-up Work

- A cross-language member audit policy, if anyone wants member documentation
  coverage measured.
- LSP navigation anchored on the manifest file itself.
- `docbridge init` support and candidate entry generation from `--audit`.
- Multiple manifests or a configurable path, if a monorepo asks for it.
