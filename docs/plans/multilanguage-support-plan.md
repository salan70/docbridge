# Multilanguage Support Plan

This plan breaks SpecLink multilanguage support into implementation slices that
are suitable for AI coding agents. Each slice should be small enough to review
independently and should leave the repository in a working state.

The first supported expansion targets are Swift and Dart. The architectural
goal is not only to add two scanners, but to make code-language support a stable
internal extension point so future languages can be added without rewriting the
resolver, graph, CLI, context command, or LSP.

Normative behavior will be reflected in these specs as the slices land:

- [Configuration](../specs/configuration.md)
- [Scanning](../specs/scanning.md)
- [Annotations](../specs/annotations.md)
- [Link Resolution](../specs/link-resolution.md)
- [Diagnostics](../specs/diagnostics.md)
- [CLI](../specs/cli.md)
- [LSP](../specs/lsp.md)

## Status

- [x] Slice 1: Language Adapter Foundation
- [x] Slice 2: Worker Protocol Foundation
- [x] Slice 3: Swift Scanner Worker
- [x] Slice 4: Swift End-to-End Integration
- [x] Slice 5: Dart Scanner Worker
- [x] Slice 6: Dart End-to-End Integration
- [x] Slice 7: Multilanguage Release Readiness

## Goals

- Replace the TypeScript-only scan pipeline with a language adapter registry.
- Require explicit language configuration for code files.
- Preserve the existing `file#fragment` link target shape while allowing
  language-specific canonical code fragments.
- Support type members for Swift and Dart code endpoints.
- Use official language parser/analyzer ecosystems for Swift and Dart rather
  than heuristic scanners.
- Keep Markdown `@code` annotations language-neutral.
- Keep the resolver, graph, context, CLI, and LSP language-aware but not
  language-specific.

## Non-Goals

- Backward compatibility with the current `include.code: string[]` config shape.
- YAML configuration.
- External third-party scanner plugins.
- Prebuilt scanner binary distribution in the initial implementation.
- TypeScript member endpoint support in the initial foundation slice.
- Fuzzy matching, shortened `@code` fragments, or automatic disambiguation of
  overload collisions.
- Full large-project or persistent-worker performance work in the first pass.

## Design Decisions

### Implementation Order

Design for Swift and Dart from the beginning, but implement Swift first and Dart
second. The first code slice should only introduce the language adapter
foundation and migrate TypeScript onto it. Swift and Dart parser integration
should follow in separate slices.

### Configuration

The canonical configuration file remains `speclink.config.json`.

Configuration is explicit and language-keyed. The old `include.code` array form
is intentionally invalid once this plan lands.

```json
{
  "include": {
    "docs": ["docs/**/*.md"],
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      },
      "swift": {
        "patterns": ["Sources/**/*.swift"],
        "visibility": ["public", "open", "internal"]
      },
      "dart": {
        "patterns": ["lib/**/*.dart"],
        "visibility": ["public"]
      }
    }
  }
}
```

Language IDs are fixed lowercase strings:

- `typescript`
- `swift`
- `dart`

Every configured language entry is an object. Shorthand arrays such as
`"swift": ["Sources/**/*.swift"]` are not supported.

If the same code file matches multiple configured languages, configuration
validation should fail with `config_invalid_value`.

### Code Endpoints

The external endpoint shape remains:

```text
file#fragment
```

The `fragment` is a language adapter produced canonical symbol ID.

`CodeSymbolEndpoint` should distinguish stable identity from human-facing names.

```ts
type CodeSymbolEndpoint = {
  kind: "code";
  language: CodeLanguage;
  filePath: string;
  symbolName: string;
  canonicalId: string;
  endpoint: string;
  location: SourceLocation;
  nameRange?: Range;
  declarationRange?: Range;
  signatureRange?: Range;
};
```

For TypeScript in the foundation slice, `canonicalId` remains equal to the
existing top-level symbol name. TypeScript member support is a later feature.

Swift and Dart start with type-member endpoints. Example canonical IDs:

```text
AuthService
AuthService.login(email:password:)
AuthService.login(_:)
AuthService.init(email:password:)
Outer.Inner.member
```

Extension members are represented as members of the extended type rather than
members of an extension declaration.

```swift
extension AuthService {
  /// @doc docs/auth.md#login
  public func login(email: String, password: String) {}
}
```

```text
Sources/Auth/AuthService.swift#AuthService.login(email:password:)
```

The `@code` backlink must match the scanner-produced endpoint exactly. Scanner
implementations should not silently add type information or other suffixes to
resolve collisions. If two supported declarations in the same file produce the
same canonical endpoint, emit `duplicate_code_symbol`.

### Annotations

Code-to-doc annotations remain documentation-comment annotations:

```swift
/// @doc docs/auth.md#login
public func login(email: String, password: String) {}
```

```dart
/// @doc docs/auth.md#login
void login(String email, String password) {}
```

Markdown backlinks remain language-neutral:

```md
<!-- @code Sources/Auth/AuthService.swift#AuthService.login(email:password:) -->
## Login Flow
```

The target language is determined from the configured code include entry that
owns the target file.

### Diagnostics

Diagnostic codes should describe the failure category, not the implementation
language. Replace the current `typescript_parse_error` with `code_parse_error`
as part of the foundation slice.

The worker foundation should also define scanner-process diagnostics before
Swift or Dart workers land:

- `code_parse_error`: the configured code file was parsed by its language
  scanner, and the scanner reported source syntax errors that make the file
  unscannable.
- `code_scanner_unavailable`: a configured first-party scanner worker cannot be
  found or executed.
- `code_scanner_failed`: a configured scanner worker started but failed to
  return a valid protocol response.

`SpecLinkDiagnostic` should gain an optional `language` field.

```ts
type SpecLinkDiagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  target: string;
  language?: CodeLanguage;
  source?: string;
  message: string;
  location?: SourceLocation;
  range?: Range;
};
```

Attach `language` only when it is known from code scanning or from a known code
endpoint:

- `code_parse_error`
- `code_scanner_unavailable`
- `code_scanner_failed`
- `unsupported_declaration`
- `duplicate_code_symbol`
- `undocumented_symbol`
- code-origin duplicate link diagnostics

Do not force language metadata onto config diagnostics, Markdown diagnostics, or
diagnostics where the target path cannot be mapped to one configured language.

### Visibility and Audit

Audit should focus on public API by default.

- TypeScript: exported top-level declarations, matching current behavior.
- Swift: `public` and `open` by default, with `internal` opt-in through config.
- Dart: public declarations by default, using Dart naming conventions such as
  excluding identifiers that start with `_`.

Language-specific visibility options should be optional and validated by the
language adapter.

### Parser Strategy

TypeScript remains in-process and uses the TypeScript Compiler API.

Swift and Dart scanners are first-party bundled scanner components implemented
outside the Bun/TypeScript core:

- Swift scanner: SwiftPM package using SwiftSyntax.
- Dart scanner: Dart package using analyzer.

The parser/analyzer dependencies are accepted because they are the official
language ecosystems for source parsing and static analysis. The core dependency
policy still applies to the Bun/TypeScript package: shared resolution and graph
logic should not depend directly on Swift or Dart packages.

Initial scanner distribution is source-bundled plus local build. Prebuilt
binary packaging can be designed after correctness and protocol stability are
proven.

### Worker Protocol

Swift and Dart scanner workers communicate with the core over stdin/stdout JSON.
Workers receive file contents from the core instead of reading project files
themselves. This keeps file IO, globbing, file-read diagnostics, and LSP overlay
handling in one place.

Request:

```json
{
  "schemaVersion": 1,
  "requestId": "1",
  "language": "swift",
  "projectRoot": "/absolute/project/root",
  "files": [
    {
      "filePath": "Sources/Auth/AuthService.swift",
      "content": "..."
    }
  ],
  "options": {
    "visibility": ["public", "open", "internal"]
  }
}
```

Response:

```json
{
  "schemaVersion": 1,
  "requestId": "1",
  "language": "swift",
  "files": [
    {
      "filePath": "Sources/Auth/AuthService.swift",
      "symbols": [],
      "undocumentedSymbols": [],
      "links": [],
      "diagnostics": []
    }
  ]
}
```

Within each worker response file entry, `undocumentedSymbols` carries supported
code endpoints that have no `@doc` annotation. The core does not report them by
default; audit mode turns these entries into `undocumented_symbol` diagnostics.
They use the same endpoint shape as `symbols` so graph, context, and LSP code
can keep one code endpoint model.

Initial implementation is process-per-scan, one request on stdin and one
response on stdout. Persistent workers are a future performance optimization.
The `requestId` exists now so the protocol can evolve without changing the
payload shape.

If a configured first-party worker cannot be executed, `speclink check` should
fail with `code_scanner_unavailable` rather than silently skipping that
language. A worker process that starts but returns invalid JSON, a mismatched
`requestId`, or otherwise violates the protocol should produce
`code_scanner_failed`.

### Position Model

All scanners must emit SpecLink positions:

- 1-based line
- 1-based column
- UTF-16 code unit columns
- end-exclusive ranges

This matches the current TypeScript/LSP-oriented model and avoids per-language
position drift in diagnostics, hover, definition, references, and context
extraction.

## Agent Workflow

AI agents should work one slice at a time.

For each slice:

1. Read this plan and the relevant specs before editing code.
2. Add or update focused Bun tests first for core behavior.
3. Add language-worker tests in that worker's native test framework when a
   worker slice touches parser behavior.
4. Implement the minimum production code required by the tests.
5. Run `just test`.
6. Run the slice-specific verification commands listed below.
7. Update this plan's status and any affected specs/schemas in the same slice.
8. Keep unrelated formatting, refactors, and generated output out of the diff.

## Proposed Module Layout

This layout is not mandatory, but agents should avoid inventing overlapping
modules without a clear reason.

```text
src/
  core/
    code-language.ts       # language IDs, adapter registry, config-facing types
    code-scanner.ts        # common CodeScanResult / adapter contract
    scanner-worker.ts      # worker request/response protocol and invocation
    typescript.ts          # TypeScript adapter implementation
    markdown.ts
    resolver.ts
    graph.ts
    context.ts
  cli/
    index.ts
packages/
  swift-scanner/
    Package.swift
    Sources/
    Tests/
  dart-scanner/
    pubspec.yaml
    bin/
    lib/
    test/
fixtures/
  diagnostics/
  multilanguage/
schemas/
  speclink.schema.json
  scanner-worker-request.schema.json
  scanner-worker-response.schema.json
```

## Slice 1: Language Adapter Foundation

Purpose: remove TypeScript-only assumptions from the core while preserving the
current TypeScript behavior through a registry adapter.

Tasks:

- Replace `include.code: string[]` with language-keyed code include entries.
- Require `speclink.config.json`; do not silently fall back to a TypeScript
  default config.
- Add `CodeLanguage`, `CodeScanResult`, and `CodeLanguageAdapter`.
- Register TypeScript as the first built-in adapter.
- Route `check`, `context`, `graph`, and LSP project resolution through the code
  language registry.
- Add `language` and `canonicalId` to code endpoints.
- Rename `typescript_parse_error` to `code_parse_error`.
- Add optional diagnostic `language`.
- Preserve TypeScript's existing top-level exported declaration scope.
- Update docs, schemas, fixtures, examples, and generated JSON expectations.

Tests:

- Config rejects missing config.
- Config rejects old `include.code` array form.
- Config accepts language-keyed object entries.
- Config rejects unknown language IDs.
- Config rejects a code path that matches more than one configured language.
- TypeScript adapter scan output matches the previous scanner behavior, with
  `language: "typescript"` and `canonicalId`.
- TypeScript parse errors are emitted as `code_parse_error`.
- Graph/context/LSP/index lookup still work for TypeScript fixtures.

Verification:

```sh
just test
just check
```

Done when:

- TypeScript projects still pass through the new adapter pipeline.
- No remaining core orchestration path imports and calls `scanTypeScript`
  directly except the TypeScript adapter itself or adapter tests.

## Slice 2: Worker Protocol Foundation

Purpose: add the first-party worker invocation boundary without implementing a
real Swift or Dart parser yet.

Tasks:

- Define scanner worker request and response types.
- Add JSON schemas for worker request and response payloads if useful for
  fixture validation.
- Add worker invocation code that sends one JSON request on stdin and reads one
  JSON response from stdout.
- Add a mock worker fixture for core tests.
- Map worker protocol failures to diagnostics, including scanner unavailable and
  scanner failed cases.
- Keep TypeScript in-process.

Tests:

- Worker request contains language, request ID, project root, file paths,
  content, and options.
- Worker response maps to `CodeScanResult`.
- Worker stderr is preserved for debug/error messaging without corrupting
  stdout JSON parsing.
- Missing configured worker emits `code_scanner_unavailable`.
- Invalid response JSON emits `code_scanner_failed`.

Verification:

```sh
just test
just check
```

Done when:

- Core can scan a configured non-TypeScript language through a mock worker and
  feed the resulting symbols, links, and diagnostics into the existing resolver.

## Slice 3: Swift Scanner Worker

Purpose: implement the first real out-of-process language scanner using
SwiftSyntax.

Tasks:

- Add `packages/swift-scanner` as a SwiftPM package.
- Add a `just test-swift-scanner` recipe that runs the Swift package tests.
- Parse request JSON from stdin and emit response JSON to stdout.
- Use SwiftSyntax to parse Swift files and extract supported declarations.
- Extract documentation comments with `@doc` annotations from `///` and
  `/** ... */` doc comments.
- Support top-level `class`, `struct`, `enum`, `protocol`, `actor`, `func`,
  `var`, `let`, and `init` where Swift syntax allows them.
- Support members of `class`, `struct`, `enum`, `protocol`, `actor`, and
  `extension`.
- Canonicalize extension members as members of the extended type.
- Produce canonical IDs using type/member names and argument labels.
- Emit `code_parse_error` for SwiftSyntax parse errors that make a file
  unscannable.
- Emit `unsupported_declaration` when `@doc` is attached to a declaration the
  scanner intentionally does not support.

Tests:

- One test per supported declaration kind.
- Member endpoints include type-qualified canonical IDs.
- Initializer and method argument labels appear in canonical IDs.
- Extension members are assigned to the extended type.
- Duplicate canonical endpoints emit `duplicate_code_symbol`.
- Unsupported annotated declarations emit `unsupported_declaration`.
- Swift parse errors emit `code_parse_error` with `language: "swift"`.
- Positions and ranges are UTF-16, 1-based, and end-exclusive.

Verification:

```sh
just test
just test-swift-scanner
```

Done when:

- The Swift scanner can produce protocol-compliant `CodeScanResult` JSON for
  representative Swift fixture files.

## Slice 4: Swift End-to-End Integration

Purpose: make Swift a usable configured language in SpecLink workflows.

Tasks:

- Register the Swift first-party worker adapter.
- Add Swift fixture projects under `fixtures/multilanguage/`.
- Add Swift examples if useful.
- Validate Swift include patterns and visibility options.
- Ensure `check`, `context`, `graph --json`, and LSP navigation include Swift
  endpoints and language metadata.
- Update user-facing docs and integration skills where they mention TypeScript
  only.

Tests:

- `speclink check` passes on a bidirectional Swift/Markdown fixture.
- Missing Swift doc anchors and missing Swift backlinks produce existing
  relationship diagnostics.
- `speclink context` renders Swift declaration blocks with a Swift code fence.
- `graph --json` includes `language: "swift"` on code nodes.
- LSP definition/references can traverse between Markdown and Swift endpoints.

Verification:

```sh
just test
just check
just test-swift-scanner
```

Done when:

- A Swift project can use `@doc` and Markdown `@code` annotations end to end.

## Slice 5: Dart Scanner Worker

Purpose: add the second real out-of-process language scanner and validate that
the adapter/worker boundary is not Swift-specific.

Tasks:

- Add `packages/dart-scanner` as a Dart package.
- Add a `just test-dart-scanner` recipe that runs the Dart package tests.
- Parse request JSON from stdin and emit response JSON to stdout.
- Use Dart analyzer to parse Dart files and extract supported declarations.
- Extract documentation comments with `@doc` annotations from Dart doc comments.
- Support top-level functions, variables, classes, enums, mixins, extensions,
  constructors, methods, getters, setters, and fields where they are public
  according to Dart naming conventions.
- Produce canonical IDs using type/member names and constructor or parameter
  labels where appropriate.
- Emit `code_parse_error` for analyzer parse errors that make a file
  unscannable.
- Emit `unsupported_declaration` for annotated declarations the scanner
  intentionally does not support.

Tests:

- One test per supported declaration kind.
- Public/private naming rules drive `undocumentedSymbols`.
- Constructor and member canonical IDs are stable.
- Extension members are assigned to the extended type when possible.
- Duplicate canonical endpoints emit `duplicate_code_symbol`.
- Dart parse errors emit `code_parse_error` with `language: "dart"`.
- Positions and ranges are UTF-16, 1-based, and end-exclusive.

Verification:

```sh
just test
just test-dart-scanner
```

Done when:

- The Dart scanner can produce protocol-compliant `CodeScanResult` JSON for
  representative Dart fixture files.

## Slice 6: Dart End-to-End Integration

Purpose: make Dart a usable configured language in SpecLink workflows.

Tasks:

- Register the Dart first-party worker adapter.
- Add Dart fixture projects under `fixtures/multilanguage/`.
- Validate Dart include patterns and visibility options.
- Ensure `check`, `context`, `graph --json`, and LSP navigation include Dart
  endpoints and language metadata.
- Update docs and integration skills for general code-language wording where
  they still say TypeScript-only.

Tests:

- `speclink check` passes on a bidirectional Dart/Markdown fixture.
- Missing Dart doc anchors and missing Dart backlinks produce existing
  relationship diagnostics.
- `speclink context` renders Dart declaration blocks with a Dart code fence.
- `graph --json` includes `language: "dart"` on code nodes.
- LSP definition/references can traverse between Markdown and Dart endpoints.

Verification:

```sh
just test
just check
just test-dart-scanner
```

Done when:

- A Dart project can use `@doc` and Markdown `@code` annotations end to end.

## Slice 7: Multilanguage Release Readiness

Purpose: align docs, examples, CI, and release behavior around the new
multilanguage architecture.

Tasks:

- Add a migration note from the old TypeScript-only config to the new
  language-keyed config.
- Update README, Japanese docs, AI integration docs, and skill templates where
  they still present TypeScript as the only code language.
- Add final schema validation for the new config and worker protocol.
- Decide which Swift/Dart jobs are mandatory in CI and which remain
  platform/toolchain-specific.
- Document local build requirements for Swift and Dart scanner workers.
- Confirm `just check`, `just test`, and `just build` cover the right default
  set for local development.

Tests:

- Example projects cover TypeScript, Swift, and Dart.
- Diagnostic fixtures include `code_parse_error`.
- Config schema rejects old and ambiguous config shapes.
- Documentation examples pass `speclink check` where they are executable.

Verification:

```sh
just test
just check
just build
```

Plus scanner-native test commands on supported local and CI environments.

Done when:

- The repository documents and validates the multilanguage workflow clearly
  enough for a new project to adopt Swift or Dart support without reading the
  implementation.

## Open Follow-Ups

- Whether TypeScript member support should follow Dart or wait for user demand.
- Whether persistent scanner workers are needed for acceptable LSP performance.
- Whether scanner workers should eventually be distributed as prebuilt binaries.
- Whether external third-party scanner plugins should be supported after the
  first-party adapter API has stabilized across at least three languages.
- Whether graph output should expose both `symbolName` and a richer
  `displayName` after real Swift/Dart UI usage is observed.
