# Language Wave and Rust Evaluation Plan

This plan implements two accepted issues that share infrastructure:

- [issue #172](https://github.com/salan70/docbridge/issues/172): evaluate a
  Rust core for agent-driven development before any migration;
- [issue #173](https://github.com/salan70/docbridge/issues/173): add
  JavaScript, Python, Ruby, and Java language support.

The issues own the problem statements, boundaries, and acceptance criteria.
This plan owns the decisions and the order. The
[Go plan](done/go-language-support-plan.md) is the precedent for a language
slice; this plan repeats only what differs.

Normative behavior is reflected in these specs as the slices land:

- [Configuration](../specs/configuration.md)
- [Scanning](../specs/scanning.md)
- [Annotations](../specs/annotations.md)
- [Diagnostics](../specs/diagnostics.md)
- [LSP](../specs/lsp.md)

## Status

- [ ] Slice A (#172): Phase 0 harness, frozen fixtures, and the Rust port of
      the resolver and graph
- [ ] Slice B (#172): comparison tasks, report, and decision record
- [ ] Slice C (#173): language specifications, provisional worker schema,
      pending fixtures, and the Python, Ruby, and Java workers (unregistered)
- [ ] Slice D (#173): core infrastructure T1–T3 and the JavaScript adapter, in
      the core the decision record names
- [ ] Slice E (#173): registration, examples, docs, and release of JavaScript,
      Python, and Ruby
- [ ] Slice F (#173): registration, examples, docs, and release of Java

Slices A and C are independent and run in parallel. Slice D starts after
Slice B's decision record. Slices E and F need C and D.

## Pull requests

| PR  | Slices | Release label    |
| --- | ------ | ---------------- |
| 1   | plan   | `release: none`  |
| 2   | A + B  | `release: none`  |
| 3   | C      | `release: none`  |
| 4   | D + E  | `release: minor` |
| 5   | F      | `release: minor` |

PR 3 branches from `main` in parallel with PR 2; it touches the plan only to
check its own box. The PR that lands Slice F checks the last box, moves this
plan to `done/`, and adds it to `done/README.md`.

## Slice A: Phase 0 harness and Rust port

### Scope of the port

`src/link/resolver.ts` (`resolveLinks`) and `src/link/graph.ts`
(`buildLinkGraph`, `counterpartsOf`), plus the helpers they depend on:
`collectErroredFiles` and `sortDiagnostics` from `src/model/diagnostics.ts`,
`filePathOf` and `compareEndpointOrder` from `src/model/endpoint.ts`, and
`comparePaths` from `src/shared/path-order.ts`. The port must preserve the
distinction the specs draw between backlink diagnostics
(`doc_backlink_not_found`, `code_backlink_not_found`) and navigable one-way
edges in the graph.

### Crate

- Location: `packages/rust-core-experiment/` with `publish = false` and the
  workspace-less layout of `packages/rust-scanner/`. It is deleted in the PR
  that records a no-go, or moved into the migration plan on go.
- Dependencies: std, `serde`, `serde_json`. No CLI or LSP framework.
- Toolchain: the pin in `packages/rust-scanner/rust-toolchain.toml`.
- Binary: `phase0-runner`. It reads one JSON document on stdin:

  ```json
  {
    "codeFiles": [],
    "docFiles": [],
    "scanDiagnostics": [],
    "audit": true,
    "queries": ["docs/a.md#login", "src/a.ts#login"]
  }
  ```

  and writes `{ "diagnostics": [...], "counterparts": { "<endpoint>": [...] } }`
  where `diagnostics` is the merged and sorted set (`scanDiagnostics` plus the
  relationship diagnostics, ordered by the rule in
  [Sorting Diagnostics](../specs/diagnostics.md#sorting-diagnostics)) and each
  `counterparts` entry is the ordered `counterpartsOf` result for that query.
  JSON field names and optional-field omission match the TypeScript types in
  `src/model/types.ts` exactly.

### Frozen fixtures

- `test-fixtures/phase0/<case>/input.json` and `expected.json`.
- Two kinds of case, distinguished by directory: `generated/` and
  `specified/`.
- `generated/` cases are parity snapshots. A Bun script,
  `scripts/phase0-fixtures.ts`, generates `input.json` and `expected.json`
  for every project under `test-fixtures/diagnostics/`,
  `test-fixtures/self-audit/`, and `examples/` by running `scanProject` with
  `keepContent` and the TypeScript resolver and graph. The script is the
  only writer of `generated/`; a `just phase0-fixtures-check` recipe fails
  when regeneration would change a committed file. These cases detect
  divergence from the shipped behavior; they are not the oracle.
- `specified/` cases are the independent oracle: `expected.json` is written
  by hand from the specs, before the Rust port starts and without running
  the TypeScript implementation, and reviewed by the other agent. One case
  per rule: failed-file suppression for each of `file_read_error`,
  `code_parse_error`, `code_scanner_unavailable`, `code_scanner_failed`; an
  empty heading closing a section; an annotated but unparsable `@code`
  keeping its subtree bridged; asymmetric one-way links that navigate but
  diagnose; `duplicate_link`; `isMember` skipping in audit; counterpart
  ordering across files and positions; and every query kind (unknown
  endpoint, code endpoint, doc endpoint). A `specified/` case that the
  TypeScript implementation fails is a finding against the current core and
  is recorded in the report, not silently regenerated.
- `just phase0-parity` runs the runner over every case and diffs the output
  against `expected.json` byte for byte after canonical JSON formatting.
  Only map serialization order is normalized; positions, messages, and
  ordering are contractual.

### Held-out cases

Ten additional hand-written cases, `heldout-01` to `heldout-10`, live in
`test-fixtures/phase0-heldout/` and are excluded from `just phase0-parity`.
Each task in Slice B names the held-out cases it changes. The directory is
never mentioned in a run's task text and is not readable from a run's
working tree: the reviewer copies it in after the run reports "ready for
review".

## Slice B: comparison tasks and decision record

### Baselines

Before any comparison task starts, both arms are frozen in one commit:

- Rust arm: the crate after `just phase0-parity` passes.
- TypeScript arm: `src/link/` after the preparatory typing changes the issue
  allows: branded `Endpoint` and `FilePath` string types in `src/model/` and
  `never` exhaustiveness checks on diagnostic codes. Their effort is recorded
  in the report and excluded from the comparison.

### Tasks

Each task is an experimental specification change that both arms implement
with the same observable result. The tasks never touch `docs/specs/` or
shipped code: the task statements live in `test-fixtures/phase0/tasks/<n>.md`
and are given verbatim to every run. A statement names the behavior change,
the `generated/` and `specified/` cases whose `expected.json` it replaces
(supplied with the task), and nothing about an implementation. Every run of
a task starts from the same frozen baseline commit.

1. **Manifest-aware backlink diagnostics.** Links that arrive from a link
   manifest carry a new optional `origin: "manifest"` field on
   `LinkAnnotation`; `doc_backlink_not_found` and `code_backlink_not_found`
   are suppressed for them (today `manifest-apply` synthesizes both directions
   instead). Three cases and `heldout-01` to `heldout-03` change.
2. **Section-range audit.** `unlinked_doc_section` gains a `range` covering
   the whole section rather than the heading text: from the heading's
   location to the location of the next heading of equal or higher level,
   or to the document's end position, which the input carries per doc file
   as `endOfFile: { line, column }`. Four cases and `heldout-04` to
   `heldout-07` change.
3. **Degree-ranked counterparts.** `LinkGraph` exposes `degree(endpoint)`,
   the number of counterparts, and `counterpartsOf` orders results by
   descending degree of the counterpart, then by the existing path and
   position order. Two cases and `heldout-08` to `heldout-10` change, and the
   runner's `counterparts` entries gain `degree`.

### Runs

- Six runs minimum: three tasks, two arms. Each run is a fresh agent context
  with the same model, the same tools, and the same budget; language order
  alternates per task. The report names the model, the tool, and the budget
  (wall-clock cap and token cap) per series. Codex and Claude Code runs are
  recorded as separate series when both are used, never mixed within a task
  pair.
- A run ends when the agent reports "ready for review". The reviewer then
  runs `just phase0-parity`, the held-out cases, and an independent review
  from the other agent, and records per run: distinct root-cause defects with
  severity, compiler or type-checker catches, repair rounds, compile or
  type-check wait, ownership or typing rework, reviewer minutes, and elapsed
  time to acceptance.
- Severity classes: S1, a wrong diagnostic, position, or ordering on a
  shipped case; S2, wrong only on a held-out case; S3, a non-contractual
  defect such as a message typo or dead code. Defects aggregate per arm as
  the sum over the three tasks; the arms compare on the S1 and S2 sum, and
  "no higher severity" means the Rust arm has no S1 where the TypeScript arm
  has none.
- Threshold terms from #172: "near-zero" is at most one S1 or S2 defect per
  arm over the three tasks; "materially higher cost" is more than 20% more
  total elapsed time to acceptance or more reviewer minutes.

### Outputs

- `docs/reports/<date>-rust-core-evaluation.md`: raw per-run records and the
  aggregate against the predeclared thresholds in #172.
- `docs/decisions/rust-core-evaluation.md`: go-to-pilot, no-go, or
  inconclusive; where T1–T3 and the JavaScript adapter are implemented; and
  for go, the later slices that need their own acceptance.
- On no-go or a second inconclusive result, PR 2 deletes the crate and the
  Phase 0 fixtures and recipes.

## Slice C: specifications and workers

### Shared decisions

- New language IDs: `javascript`, `python`, `ruby`, `java`. `CodeLanguage`
  and `KNOWN_CODE_LANGUAGES` are extended only in Slice E and F, so this slice
  keeps the core untouched.
- Provisional schema: the `language` enums in
  `schemas/scanner-worker.schema.json` and `schemas/common-output.schema.json`
  (worker diagnostics reference the latter) gain the four IDs in Slice C so
  the workers can be validated against them; the registry catches up later.
  Nothing else in `schemas/` changes until registration.
- Pending fixtures live under `test-fixtures/pending-languages/<language>/`
  with the four scanner-conformance cases and move into
  `test-fixtures/scanner-conformance/<case>/<language>/` at registration.
- Each worker ships a `--probe` mode that prints one JSON line
  `{ "ok": true, "runtime": "cpython", "version": "3.12.4" }` or
  `{ "ok": false, "reason": "..." }` and exits 0 either way. The core runs it
  before the first scan of a session (T3).
- Worker tests: each worker has native table-driven tests plus JSON
  request/response cases under `packages/<name>/tests/cases/`, executed by a
  Bun test that spawns the worker. Native tests use only what the runtime
  ships: `unittest` for Python, `minitest` (bundled gem) for Ruby, and a
  plain `main`-based assertion runner for Java, so no worker adds a
  third-party dependency.
- Specs: Slice C adds the "Python Scanning", "Ruby Scanning", "Java
  Scanning", and "JavaScript Scanning" sections to `docs/specs/scanning.md`
  and the configuration, annotation, and diagnostic paragraphs, each marked as
  pending registration until Slice E or F removes the marker.

### Python worker

- Location: `packages/python-scanner/docbridge_python_scanner.py` (the
  entrypoint) and `packages/python-scanner/docbridge_python_scanner/` (the
  package), tests under `packages/python-scanner/tests/`.
- Runtime floor: CPython 3.10. Command: `python3 -I -S <absolute entrypoint>`.
  Isolated mode drops the script directory from `sys.path`, so the
  entrypoint inserts its own directory explicitly before importing the
  package; nothing else is ever added. On Windows the candidates are `py -3`
  then `python`. `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, and
  `PYTHONSAFEPATH` are removed from the child environment.
- Parsing: `ast.parse(content, filename, type_comments=False)`. A
  `SyntaxError` is `code_parse_error` at its `lineno` and `offset`; the
  partial result is discarded. `tokenize` runs over the same content only
  after `ast.parse` succeeds, to locate comments, docstring tokens, and
  names.
- Positions, three conversions kept apart: `ast` `col_offset` is a 0-based
  UTF-8 byte offset into the line; `tokenize` columns are 0-based Unicode
  code point indexes; `SyntaxError.offset` is 1-based in code points. Each
  converts to a 1-based UTF-16 column through the line's text. `end_lineno`
  and `end_col_offset` bound `declarationRange`.
- Declarations: `FunctionDef`, `AsyncFunctionDef`, and `ClassDef` at module
  level and inside class bodies, recursively for classes. The walk descends
  into `if`, `try`, `with`, `for`, `while`, and `match` bodies at module and
  class level and never into function bodies. The same name declared twice
  in one container is one endpoint at its first declaration; a second
  annotated declaration is `duplicate_code_symbol`.
- Grouping: a function decorated with `property`, `cached_property`,
  `<name>.getter`, `<name>.setter`, or `<name>.deleter` is the endpoint
  `Container.<name>`; a function decorated with `overload` shares the
  endpoint of its implementation or, with no implementation, of the first
  stub. Decorators are recognized by the last attribute segment of a `Name`
  or `Attribute` node; `Call` decorators are not grouped. A group's
  `location`, `nameRange`, `declarationRange`, and `signatureRange` are the
  first member's, as the TypeScript getter/setter collapse does. Annotations
  from every member attach to the group endpoint; the same target twice
  across members is `duplicate_link`, and a group is documented when any
  member is.
- Annotation sources: the docstring (the first body statement when it is an
  `Expr` holding a string `Constant`) and the contiguous run of `#` comment
  lines that ends on the line directly above the first decorator or the
  `def` / `class` keyword and starts at the declaration's column. The `@doc`
  search range in the docstring excludes the quote delimiters, so a target
  followed directly by `"""` does not absorb it. Positions come from the
  docstring or comment token's source text, never from `ast.get_docstring()`.
- IDs and visibility classes: the Python row of the table in #173. A name is
  `private` when it or any enclosing name starts with `_` and is not a
  `__dunder__` name. Default filter `["public"]`.
- Ranges: `location` and `nameRange` cover the name token; `declarationRange`
  starts at the leading comment block, else the first decorator, else the
  keyword, and ends at the node end; `signatureRange` ends at the `:` that
  closes the header.
- Unsupported: an `@doc` in the module docstring (at the module start) or on
  an assignment, lambda, or nested function is `unsupported_declaration` at
  the statement's first token.
- Init discovery: `src/**/*.py` when `src/` exists, plus `<pkg>/**/*.py` for
  each top-level directory holding `__init__.py`; `tests`, `venv`, `build`,
  `dist`, and `site-packages` segments are ignored when scoring.
- Tooling: `just test-python-scanner`, `format-check-python` and
  `lint-python` through `ruff` (dev shell only, `pkgs.ruff`; never a runtime
  dependency). CI runs the worker tests on CPython 3.10 and the latest
  release.

### Ruby worker

- Location: `packages/ruby-scanner/lib/docbridge_ruby_scanner.rb` and
  `bin/docbridge-ruby-scanner`, tests under `packages/ruby-scanner/test/`.
- Runtime floor: CRuby 3.3 with the bundled Prism. Command:
  `ruby --disable=gems,did_you_mean,error_highlight -W0 <absolute script>`.
  With RubyGems disabled, `require "prism"` resolves only from the runtime's
  own library directories, which is where a default gem is installed; user
  and site gem paths are never searched, so clearing `GEM_*` variables is
  unnecessary and not relied on. `RUBYOPT`, `RUBYLIB`, and
  `PRISM_FFI_BACKEND` are removed from the child environment. This is the
  decided loader; if Slice C finds a supported CRuby where the default-gem
  Prism does not load this way, that is a plan amendment, not a silent
  fallback.
- Prism compatibility: CRuby 3.3 bundles Prism 0.19 and 3.4 bundles 1.x,
  and the node API differs (for example `ConstantPathNode#child` in 0.19
  against `#name` and `#name_loc` in 1.x). A `compat.rb` module wraps every
  accessor the worker uses, and the test suite runs on both runtimes.
- Parsing: `Prism.parse(content, filepath:)`. A non-empty `errors` list is
  `code_parse_error` at the error with the smallest start offset; the
  recovered tree is discarded. Byte offsets convert to UTF-16 columns.
- Declarations: `ClassNode`, `ModuleNode`, `DefNode` (instance, `self.`
  receiver, and inside `SingletonClassNode`), `ConstantWriteNode`, and
  `ConstantPathWriteNode`, at top level and inside class or module bodies.
  Top-level `def` is `login`.
- Qualification is lexical: `class Foo::Bar` inside `module A` is
  `A::Foo::Bar`; a leading `::` (`class ::Foo`) resets to the top level and
  yields `Foo`. A constant path whose parent is not a constant (for example
  `self::X` or `obj.klass::X`) is a dynamic path and unsupported.
- Reopening: a class or module reopened in the same file is one container;
  its symbol location is the first declaration, the annotations of every
  reopening attach to it, and repeated targets are `duplicate_link`. Each
  reopening starts with `public` default visibility. A method defined twice
  in one container follows the Python duplicate rule.
- Annotation source: the contiguous run of `#` comment lines that ends on
  the line directly above the declaration. `=begin`/`=end` blocks are not
  annotation sources. Magic comments carry no `@doc` and need no special
  case.
- IDs and visibility classes: the Ruby row of the table in #173. Bare
  `private`, `protected`, and `public` calls change the default for later
  instance `def`s in the same body and never affect singleton methods;
  `private def x` and `private :x, :y` apply to the named instance methods;
  `private_class_method :x` applies to the named singleton methods. Classes,
  modules, and constants are always `public`. Default filter `["public"]`.
- Ranges: `nameRange` is the constant or method name; `declarationRange`
  starts at the comment block, else the keyword, and ends at `end` (or the
  end of the assignment); `signatureRange` ends at the end of the parameter
  list or the name when there is none.
- Unsupported: `@doc` above `attr_*`, `alias`, `define_method`, a singleton
  method on a non-`self` receiver, or a dynamic constant path is
  `unsupported_declaration`.
- Init discovery: `lib/**/*.rb` and `app/**/*.rb`; `spec`, `test`, and
  `vendor` segments are ignored when scoring.
- Tooling: `just test-ruby-scanner`; no formatter (RuboCop is third-party).
  CI runs the worker tests on CRuby 3.3 and 3.4 because their bundled Prism
  versions differ (0.19 and 1.x).

### Java worker

- Location: `packages/java-scanner/src/` compiled by `javac --release 17`
  and packed with `jar` into `packages/java-scanner/build/docbridge-java-scanner.jar`;
  no Maven or Gradle. Tests under `packages/java-scanner/tests/` use a
  `main`-based runner over the JSON cases.
- Runtime floor: JDK 17 with the `jdk.compiler` module; `.java-version` pins
  `17` for the dev shell (`pkgs.jdk17_headless`) and `actions/setup-java`.
  Command: `java -Xshare:auto -XX:TieredStopAtLevel=1 -XX:+UseSerialGC -jar
<jar>`; `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, and `_JAVA_OPTIONS` are
  removed from the child environment. `--probe` reports `ok: false` when
  `ToolProvider.getSystemJavaCompiler()` is null.
- Parsing: `ToolProvider.getSystemJavaCompiler().getTask(...)` cast to
  `com.sun.source.util.JavacTask` (a public API of `jdk.compiler`; the
  internal `com.sun.tools.javac` packages are never imported, so
  `--release 17` compiles cleanly), with `-proc:none -implicit:none
-Xlint:none`, no classpath, and `parse()` only; `analyze()` is never
  called. Diagnostics of kind `ERROR` make the file `code_parse_error` at
  the smallest start position.
- Positions: offsets from `Trees.getSourcePositions` are UTF-16 code unit
  indexes into the content. Line and column are computed by the worker from
  the content's own line starts, never from `LineMap`, which expands tabs.
  The name position is found by scanning the source between the end of the
  last header subtree (modifiers, type parameters, return type) and the
  name token, skipping comments and whitespace.
- JSON: the worker carries a small hand-written JSON reader and writer in
  `packages/java-scanner/src/.../Json.java`, because the JDK ships none and
  the worker takes no third-party dependency.
- Declarations: `ClassTree` of every kind (class, interface, enum, record,
  annotation type) at top level and nested; `MethodTree` methods and
  constructors; `VariableTree` fields and enum constants. Local and anonymous
  classes, initializer blocks, and lambdas are skipped.
- IDs: `Foo`, `Foo.Inner`, `Foo.MAX`, `Foo.bar(int,String)`,
  `Foo.Foo(int)`. Parameter types are printed from the type tree: annotations
  and type arguments removed, qualified names and type variables kept as
  written, arrays as `T[]`, varargs as `T[]`, no whitespace.
- Annotation source: the `/** */` comment javac associates with the
  declaration. `DocTrees.getDocComment` is used only as the association
  test, because it returns the comment with its formatting stripped; the raw
  text and its offsets come from the source: the comment ending at the last
  `*/` before the declaration's start position with only whitespace between
  them, and opening with `/**`. `//` and `/* */` comments are ignored. The user guide documents
  `javadoc -tag doc:a:"DocBridge:"` for projects that run Javadoc with
  `-Xdoclint`.
- Visibility: `public`, `protected`, `package`, `private` from modifiers;
  interface members and enum constants without a modifier are `public`. An
  endpoint's class is the least visible of its own and every enclosing
  type's. Default filter `["public"]`.
- Ranges: `declarationRange` starts at the doc comment, else the first
  modifier or annotation, and ends at the tree end; `signatureRange` ends
  before the body's opening brace for methods and types and equals
  `declarationRange` for fields.
- Init discovery: `src/main/java/**/*.java`, else `src/**/*.java`; `build`,
  `target`, and `src/test` segments are ignored when scoring.
- Tooling: `just build-java-scanner` and `test-java-scanner`; `lint-java` is
  `javac -Xlint:all -Werror`. No formatter is adopted, matching Ruby, because
  every Java formatter is a third-party download.

### JavaScript specification

Slice C writes the specification only; the adapter lands in Slice D.

- Suffixes: `javascript` claims `.js`, `.jsx`, `.mjs`, `.cjs`; `typescript`
  claims `.ts`, `.tsx`, `.mts`, `.cts` and excludes `.d.ts`, `.d.mts`,
  `.d.cts`. `ScriptKind` follows the suffix: `JS`, `JSX`, `TS`, `TSX`.
- Declarations: the ESM `export` forms the TypeScript scanner supports and
  their class members. CommonJS assignments, script globals, and JSDoc
  `@typedef` are out of scope; an `@doc` on `module.exports = ...` is
  `unsupported_declaration`.
- Visibility: the TypeScript contract unchanged, as #173 requires: `public`,
  `protected`, and `private` are accepted and the default is
  `["public", "protected"]`. JavaScript members carry no modifier, so every
  member classifies as `public`; `#private` names are unsupported as in
  TypeScript.
- Context and hover fences follow the suffix: `js`, `jsx`, `ts`, `tsx`.
- Editor language IDs: `javascript`, `javascriptreact`; `typescriptreact` is
  already selected.

## Slice D: core infrastructure and JavaScript adapter

The decision record of Slice B names the core. Under #172, T1–T3 and the
JavaScript adapter stay in the TypeScript core after no-go, inconclusive, or
go-to-pilot; only a separate decision record that approves a full migration
moves them into a Rust migration plan and re-scopes this slice there. The
design below is written for the TypeScript core.

### T1: suffix sets

- `LANGUAGE_SUFFIX` becomes `LANGUAGE_SUFFIXES: Record<CodeLanguage,
readonly string[]>`; a pattern must end with one of them. The TypeScript
  `.d.ts` exclusion generalizes to `EXCLUDED_SUFFIXES` per language and is
  applied in `collectCodeFiles`, `codeFileOwners`, and the LSP overlay
  collection, replacing the two `endsWith(".d.ts")` checks in
  `src/lsp/project.ts`.
- Suffix sets never overlap across languages, so the existing "file claimed
  by two languages" rule is unchanged.

### T2: batched dispatch and LSP scheduling

- `CodeLanguageAdapter` gains `scanFiles(files, options, context):
CodeScanResult[]`; `scanFile` remains for single-file callers. The worker
  adapter sends every file of a language in one request. A whole-process
  failure yields the file-scoped `code_scanner_failed` or
  `code_scanner_unavailable` for every file in the request, and the resolver
  suppresses derived diagnostics for each as today.
- Limits: the request is not capped, because the core already holds every
  managed file's content in memory before scanning, so batching does not
  raise the peak. Worker output above the existing 1 GiB `maxBuffer` is
  `code_scanner_failed` for every file in the request. The per-invocation
  timeout becomes `30 s + 1 s × files`.
- `scanFiles` stays synchronous for the CLI. Worker adapters also expose
  `scanFilesAsync`, which spawns with `child_process.spawn` and returns a
  promise plus a cancel handle; only the LSP uses it.
- `Project` in `src/lsp/project.ts` gains `resolveAsync()` and caches
  `CodeScanResult` per `(language, path, content hash, visibility, resolved
worker argv)`, sending only changed or new files to the worker. A change
  to the configuration or to a resolved runtime clears the cache.
- Scheduling: a change that arrives during a scan schedules exactly one
  follow-up scan; results of a scan that started before the newest change
  are discarded (stale-result rejection) and its in-flight worker is killed
  (cancellation). Navigation, hover, and reference requests during a scan
  answer from the last completed state. `just` gains `lsp-latency` that
  records cold and warm p95 for `examples/java` once Slice F exists.

### T3: runtime-backed workers

- Configuration gains an optional top-level `scanners` object:
  `"scanners": { "python": { "command": ["/opt/py/bin/python3"] } }`. The
  array is argv; a relative first element resolves against the project root.
  An invalid override (missing file, probe failure) is
  `code_scanner_unavailable` naming the override; no fallback.
- Without a configuration override, `DOCBRIDGE_<LANGUAGE>_RUNTIME` (a single
  executable path) is an explicit override too: when set, it is the only
  candidate and fails without fallback. Only the documented candidates fall
  through to the next one on a failed probe.
- The bundled script or JAR resolves under `packages/<name>/` from a source
  checkout and `dist/workers/<language>/` from the npm package; `just build`
  copies them, and `verify-dist` and `pack-smoke` assert they run.
- Probe results are cached per CLI process and per LSP session, keyed by the
  full argv and the values of `PATH` and `DOCBRIDGE_*`; a configuration
  change invalidates the cache. Probes are limited to 10 s and 64 KiB of
  output.
- Diagnostics: a missing runtime, a probe that answers `ok: false`, or an
  unsupported version is `code_scanner_unavailable` with the runtime name,
  the floor, and what was found. A probe or scan that crashes, times out, or
  returns malformed output is `code_scanner_failed`.
- `supportedScannerPlatformKeys()` stays for native workers; runtime-backed
  languages are not platform-gated. `pack-smoke` runs on Linux, macOS, and a
  Windows job, covering an install path with spaces, a read-only install,
  and a missing runtime.

### JavaScript adapter

- `typescript.ts` takes the `ScriptKind` from the suffix and reports
  `language: "javascript"` for JavaScript files; the rest of the scanner is
  shared. Fixtures for `.js`, `.jsx`, `.tsx`, `.mjs`, `.cjs` cover exports,
  members, JSX in declarations, and `module.exports` as unsupported.

## Slice E: JavaScript, Python, and Ruby registration

- Registry, config maps (suffixes, visibility, init candidates, fences),
  `schemas/docbridge.schema.json` entries, common, graph, and context output
  schemas, the worker adapter map, executable and runtime resolution, and
  the conformance corpus for the three languages.
- `examples/javascript`, `examples/python`, `examples/ruby` with
  `docbridge.config.json` and `docs/*.md`; integration tests per language
  covering `check`, `context`, graph, LSP navigation and hover, and the link
  manifest; `include.code.<language>` in the diagnostic fixtures that
  enumerate every language.
- Specs lose the pending marker; user docs in English and `docs/ja/`,
  README, editor README, and the `getting-started` description asserted by
  `docs.test.ts`; VS Code activation events and document selectors;
  CHANGELOG entry; `release: minor`.

## Slice F: Java registration

Same shape as Slice E for `java`, plus the `lsp-latency` measurement recorded
in the PR, the Javadoc `-tag` guidance in the user docs, and the release
packaging of `dist/workers/java/`.

## Acceptance mapping

| Acceptance criterion (issue)                                        | Slice |
| ------------------------------------------------------------------- | ----- |
| #172 plan with fixtures, baselines, tasks, metrics, thresholds      | A     |
| #172 crate reproduces every frozen fixture                          | A     |
| #172 comparison runs recorded under `docs/reports/`                 | B     |
| #172 decision record under `docs/decisions/`                        | B     |
| #173 config and schema validation for the four languages            | E, F  |
| #173 conformance cases per language                                 | C→E/F |
| #173 IDs, attachment, visibility by table-driven tests              | C     |
| #173 runtime-backed diagnostics and packed smoke on three platforms | D     |
| #173 batched dispatch, LSP scheduling, Java latency                 | D, F  |
| #173 examples pass check, context, graph, LSP                       | E, F  |
| #173 specs, user docs, extension activation                         | E, F  |
| Existing languages keep passing `just verify`                       | A–F   |
