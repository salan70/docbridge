# Single-Binary Parser Gate Plan

This plan implements Phase 0 of
[issue #200](https://github.com/salan70/docbridge/issues/200): measure whether
in-process parsers can replace the scanner workers, before any migration to a
single Rust binary.

The issue owns the problem statement, the boundaries, the acceptance criteria,
and the decision rule. This plan owns the choices the issue leaves open and the
order of work. Phase 0 ships nothing: no scanner is registered, packaged, or
released.

## Status

- [ ] Slice A: specified fixtures, candidate crate, Swift and Dart extractors,
      and the conformance runner
- [ ] Slice B: corpus tooling, generated fixtures, and the comparison runner
- [ ] Slice C: development-set measurement and candidate fixes
- [ ] Slice D: nine-parser executable and the operational checks
- [ ] Slice E: final holdout measurement, report, and decision record

Slices A and D are independent. Slice B needs the candidate's command line
from Slice A. Slice C needs A and B. Slice E starts only after the pull request
for Slices A–D has merged.

## Pull requests

| PR  | Slices | Release label   |
| --- | ------ | --------------- |
| 1   | plan   | `release: none` |
| 2   | A–D    | `release: none` |
| 3   | E      | `release: none` |

The merge commit of PR 2 freezes the candidate. PR 3 measures that commit and
changes no candidate code. PR 3 also checks the last box, moves this plan to
`done/`, and adds it to `done/README.md`. On a no-go, PR 3 deletes the crate,
its fixtures, its scripts, its recipes, and its workflow.

## Candidate

The candidate is one Rust crate that takes the place of a scanner worker in
the comparison.

- Location: `packages/parser-gate/`, with `publish = false` and the
  workspace-less layout of `packages/rust-scanner/`. `Cargo.lock` is committed.
- Toolchain: Rust 1.98.1, pinned in `packages/parser-gate/rust-toolchain.toml`.
  The flake provides it in a separate `parser-gate` development shell. The
  default shell and the 1.83.0 pin of `packages/rust-scanner` do not change.
- Recipe: `just parser-gate-verify` formats, lints, builds, and tests the
  crate, then runs the fixture runners. `just verify` does not include it.
- Workflow: `.github/workflows/parser-gate.yml` runs the recipe and the
  five-target build of Slice D on pull requests that change the crate, its
  scripts, or its fixtures.
- Binary: `parser-gate`, with two subcommands.
  - `scan` reads one worker request on stdin and writes one response, as
    `schemas/scanner-worker.schema.json` defines them. It accepts `swift` and
    `dart`.
  - `parse <language>` parses the files named on stdin and writes one record
    per file: accepted or rejected, the first error position, and the parse
    time. It accepts all nine languages.
- Rejection: `scan` rejects a file whose tree contains an `ERROR` or `MISSING`
  node. It reports one `code_parse_error` at the first such node and no
  symbols or links, as [Scanning](../specs/scanning.md) requires today.
- Extraction: the extractors implement
  [Swift scanning](../specs/scanning.md#swift-scanning),
  [Dart scanning](../specs/scanning.md#dart-scanning), and
  [Annotations](../specs/annotations.md). Where the specifications are silent,
  the shipped worker's behavior is the reference.

### Parsers

Every version is an exact pin. The tree-sitter grammars run on `tree-sitter`
0.25.10.

| Language               | Parser               | Version | Shipped scanner parses with                    |
| ---------------------- | -------------------- | ------- | ---------------------------------------------- |
| Swift                  | `tree-sitter-swift`  | 0.7.4   | swift-syntax 602.0.0                           |
| Dart                   | `tree-sitter-dart`   | 0.2.0   | `analyzer` 9.0.0                               |
| Rust                   | `syn`                | 2.0.119 | the same crate and version                     |
| Ruby                   | `ruby-prism`         | 1.9.0   | Prism, through the CRuby on the machine        |
| TypeScript, JavaScript | `oxc_parser`         | 0.153.0 | the TypeScript 5.9.3 compiler                  |
| Python                 | `ruff_python_parser` | 0.0.17  | `ast` and `tokenize` of the CPython on machine |
| Go                     | `tree-sitter-go`     | 0.25.0  | `go/parser` of Go 1.26.3                       |
| Java                   | `tree-sitter-java`   | 0.23.5  | `javac` of the JDK on the machine              |

Phase 0 extracts symbols only for Swift and Dart. The other seven parsers are
linked and checked for agreement on acceptance, as Slice D describes. A parser
that fails to build for a target at its pinned version is a Slice D finding. A
version changes only before PR 2 merges, and the report states the reason.

## Corpus

### Selection

The repositories come from GitHub's repository search for the language, in
star order, as returned on 2026-10-12. The walk skips a repository when any of
these holds:

- it is archived or a fork, or its last push is before 2025-10-12;
- it is not mainly source code in the language: a list, tutorial, book, sample
  collection, or algorithm collection;
- it is the language's own compiler, parser, or toolchain;
- its code is part of an exploratory corpus the issue names;
- it has no license with an SPDX identifier;
- it has fewer than 50 counted files.

The first 12 eligible repositories form the base. At least four must be
applications and at least four must be libraries or frameworks; the
lowest-ranked surplus repositories of one kind give way to the next eligible
ones of the other. While the capped corpus is below 5,000 files, the walk adds
the next eligible repository of any kind.

A counted file is a regular file, not a symbolic link, at the pinned commit.
It ends in `.swift` or `.dart` and has no path segment named
`Pods`, `Carthage`, `vendor`, `Vendor`, `third_party`, `ThirdParty`,
`node_modules`, `.build`, `build`, `DerivedData`, `generated`, `Generated`,
`gen`, or `.dart_tool`. Dart files ending in `.g.dart`, `.freezed.dart`,
`.gr.dart`, `.mocks.dart`, `.pb.dart`, `.pbenum.dart`, `.pbjson.dart`,
`.pbgrpc.dart`, or `.config.dart` are not counted. The fetch fails when a
repository's counted files differ from the tables below. It drops and records
counted files that are not valid UTF-8.

### Split, cap, and sampling

- Split: the repositories of each kind group, in star order, take positions
  1, 2, 3, and so on. The groups are applications with tools, and libraries
  with frameworks. Positions 1, 4, 7, … form the development set. The others
  form the final holdout.
- Cap: no repository contributes more than 20% of the final holdout's files,
  or more than 20% of the corpus's files. The "Used" column fixes the result.
- Sampling: a repository with more counted files than "Used" keeps the files
  with the lowest SHA-256 of their repository-relative path.

### Swift repositories

Sixteen repositories give 5,246 files: 1,766 for development and 3,480 for the
final holdout.

| Rank | Repository                   | Kind        | License          | Commit                                     | Set         | Counted | Used |
| ---: | ---------------------------- | ----------- | ---------------- | ------------------------------------------ | ----------- | ------: | ---: |
|    4 | `apple/container`            | tool        | Apache-2.0       | `f70ecbb926d925818a34917529e304b1177ce98c` | development |     467 |  467 |
|    5 | `iina/iina`                  | application | GPL-3.0          | `2afb9f20f6b4a049f9db066e55b4b7a457fa4e81` | holdout     |     221 |  221 |
|    6 | `exelban/stats`              | application | MIT              | `0c0e551e199938a92af963c25a15a3ca1aef7764` | holdout     |     122 |  122 |
|    7 | `Alamofire/Alamofire`        | library     | MIT              | `bda9ed57d72988a3a2ada33d824583541f86eac6` | development |     101 |  101 |
|    8 | `permissionlesstech/bitchat` | application | Unlicense        | `5e9287fae1e5fea80ca741d4ea669829dc16f144` | development |     530 |  530 |
|    9 | `utmapp/UTM`                 | application | Apache-2.0       | `7eadb056ae0f91d979059544d0ddcd2d5a40be92` | holdout     |     240 |  240 |
|   12 | `rxhanson/Rectangle`         | application | MIT              | `810ee5ba6ee14bc71a8feef132228c7b62cf4c0f` | holdout     |     214 |  214 |
|   13 | `jordanbaird/Ice`            | application | GPL-3.0          | `11edd39115f3f43a83ae114b5348df6a0e1741cf` | development |     116 |  116 |
|   15 | `manaflow-ai/cmux`           | application | GPL-3.0-or-later | `df66cb4df7e0c8e9ff97abcb6e6a44b53f8b3605` | holdout     |  13,108 |  696 |
|   16 | `ChartsOrg/Charts`           | library     | Apache-2.0       | `1bad5469f57628782110b05996d4fa00473abf06` | holdout     |     205 |  205 |
|   17 | `airbnb/lottie-ios`          | library     | Apache-2.0       | `1fb4d7d5b45b0e81239c0c0cab95136a10153762` | holdout     |     323 |  323 |
|   18 | `vorssaint/vorssaint-utils`  | application | GPL-3.0          | `fe24c1766d568b132c1c78c554cc422381a3a17d` | holdout     |     859 |  696 |
|   19 | `vapor/vapor`                | framework   | MIT              | `bf77fc69b1426dd297c78938349e0c7468be56be` | development |     268 |  268 |
|   20 | `ReactiveX/RxSwift`          | library     | MIT              | `3e33f90c1bcd3cdea25bdb49bd4a594a50c3ab84` | holdout     |     588 |  588 |
|   21 | `onevcat/Kingfisher`         | library     | MIT              | `08557202ba5a412758fa09f01c4e807f2ad94036` | holdout     |     175 |  175 |
|   22 | `nikitabobko/AeroSpace`      | application | MIT              | `74a1bf17e82d70e0a21945ba04bb4f590bf19f83` | development |     284 |  284 |

Ranks 18 and 20–22 extend the base of 12, which gave fewer than 5,000 files.
Skipped above rank 22: 1 and 3 are lists; 2 is the Swift compiler; 10 and 11
have fewer than 50 counted files; 14 was last pushed in 2024.

### Dart repositories

Twelve repositories give 7,361 files: 4,056 for development and 3,305 for the
final holdout.

| Rank | Repository             | Kind        | License      | Commit                                     | Set         | Counted |  Used |
| ---: | ---------------------- | ----------- | ------------ | ------------------------------------------ | ----------- | ------: | ----: |
|    1 | `flutter/flutter`      | framework   | BSD-3-Clause | `33aadb51de4a494175c745a1d9101d9ef22ee53e` | development |   6,536 | 1,472 |
|    2 | `localsend/localsend`  | application | Apache-2.0   | `14f3a87426eedffaa9d87d011132eca5501abeb8` | development |     326 |   326 |
|    3 | `AppFlowy-IO/AppFlowy` | application | AGPL-3.0     | `5cf3a365dec0d59f64bad1ee4bb1050471a39b93` | holdout     |   1,976 |   661 |
|    5 | `chen08209/FlClash`    | application | GPL-3.0      | `4b59eca853778d4e7be3de26589252889c899bc5` | holdout     |     748 |   661 |
|    6 | `team-spotube/spotube` | application | BSD-4-Clause | `69a310c78f5ceaf4eab7dfee98f187d38211c9ba` | development |     382 |   382 |
|    7 | `Predidit/Kazumi`      | application | GPL-3.0      | `dc18be2af7636ae852cb49d0c4460e49b04b467c` | holdout     |     390 |   390 |
|    9 | `ente/ente`            | application | AGPL-3.0     | `3b27b97bbda881ea8f6ab63b99a5fd675554c1cd` | holdout     |   1,840 |   661 |
|   10 | `GopeedLab/gopeed`     | application | GPL-3.0      | `fa622a4063ad72939d3f031eac95b26760a4e15f` | development |     404 |   404 |
|   14 | `ImranR98/Obtainium`   | application | GPL-3.0      | `af286fa8d31d7406d6db167e2314d376d74f7696` | holdout     |     109 |   109 |
|   27 | `felangel/bloc`        | library     | MIT          | `b9be1e252ee24ffbe9f2fb629edc7624b2cfbf05` | holdout     |     606 |   606 |
|   29 | `jonataslaw/getx`      | library     | MIT          | `e3c8fa04ae65ebf7ff0128dbeb2dc91d4dafa429` | holdout     |     217 |   217 |
|   31 | `flame-engine/flame`   | framework   | MIT          | `09ca927bc390b51e9e6e6fafdc128bebb3a5aedd` | development |   1,742 | 1,472 |

Skipped above rank 31: 4 is a list; 8 has a non-standard license; 11 and 13
were last pushed before the cutoff; 12 and 16 are sample collections; 17, 24,
and 30 are archived; 20 has no license; 26 (`cfug/dio`) is in the exploratory
corpus; 28 is the Dart SDK. Ranks 15, 18, 19, 21, 22, 23, and 25 are
applications passed over for the kind balance without an eligibility check.

### Handling

- `scripts/parser-gate/fetch-corpus.ts` fetches one set by name at the pinned
  commits into `.tmp/parser-gate/corpus/`, which Git ignores. The corpus is
  never committed.
- The final holdout is not fetched, listed, or parsed before PR 2 merges. The
  exploratory corpora the issue names are not used at all.
- Reports hold paths, symbol names, positions, and counts. Reproductions are
  written by hand and copy no corpus source.
- A repeat after an inconclusive result takes the next eligible repositories
  of the same walk as a new holdout. They are not listed or fetched before the
  repeat.

## Fixtures

Committed fixtures live under `test-fixtures/parser-gate/`.

- Conformance: the Swift and Dart cases of
  `test-fixtures/scanner-conformance/`. The existing test invokes registered
  adapters only, so `scripts/parser-gate/conformance.ts` sends each
  `input.txt` to the candidate through `invokeScannerWorker` and compares the
  result with `expected.json`.
- Specified cases: `specified/<language>/<case>/` holds an input, its request
  options, and an `expected.json` written by hand from the specifications.
  Slice A writes them before the extractor of that language. They cover:
  - every declaration kind the language's scanning section lists, documented
    and undocumented, under every visibility value the configuration accepts;
  - every annotation form and annotation diagnostic that
    [Annotations](../specs/annotations.md) defines for the language;
  - positions after a non-BMP character, a combining mark, a tab, a CRLF line
    ending, and a byte-order mark, for a symbol name and an annotation target;
  - end-exclusive ranges of one-line, multi-line, and end-of-file
    declarations, including a file without a final newline.
- Injected annotations, generated at run time: in each corpus file, the runner
  takes the symbols the shipped worker reports as undocumented and whose
  preceding line is blank or ends in `{`. It picks the one with the lowest
  SHA-256 of its canonical ID and inserts `/// @doc docs/gate.md#injected`
  above it, at the same indentation. The expected result follows from the
  insertion alone: exactly one link, on that symbol, located at the inserted
  target.
- Malformed files, generated at run time: for the 500 files of each set with
  the lowest path hash, three mutations at hash-chosen positions: delete one
  `}`, insert one `(`, and truncate at a line boundary.

A specified case that the shipped worker fails is a finding against the
worker. The report records it, and nobody regenerates the expected file to
match.

## Comparison

`scripts/parser-gate/compare.ts` sends the same requests to the shipped worker
and to the candidate, and writes one record per file and configuration.

- Shipped worker: the Swift and Dart workers that `just build-swift-scanner`
  and `just build-dart-scanner` build from the measured commit.
- Configurations: Swift runs with the default visibility (`public`, `open`)
  and with `public`, `open`, `internal`. Dart runs with `public`.
- Requests: batches of 40 files. A batch that fails as a whole is retried one
  file at a time. A file on which the shipped worker itself fails is recorded
  and excluded.
- Compared: `symbols`, `undocumentedSymbols`, `links`, and `diagnostics`, with
  every range and location, in the order returned. Only JSON key order is
  normalized.
- Recorded, not gated: the position of `code_parse_error`. The record keeps
  both positions, and the report summarizes their distance. The message is
  not compared.

The decision rule of the issue uses these terms:

- An implementation _rejects_ a file when its response carries
  `code_parse_error`. Otherwise it _accepts_ the file.
- A file is _identical_ when everything compared is equal in every
  configuration.
- The rejection rate counts unmodified corpus files only: the files the
  candidate rejects among the files the shipped worker accepts.
- Injected and malformed variants that both implementations accept must be
  identical, like unmodified files. Agreement on rejecting malformed files is
  reported, not gated.

Every differing file gets one or more causes: a grammar limitation, a
candidate defect, worker behavior the specifications do not require, or a
fixture defect. Each cause has a hand-written minimal reproduction under
`test-fixtures/parser-gate/repro/`. A difference without a reproduced cause is
unexplained. The record also names the construct: the tree-sitter node kind
that encloses the first difference or error.

Candidate fixes use the fixtures and the development set only, and each fix
keeps its reproduction as a regression case.

## Operational checks

Slice D builds `parser-gate` in release mode for `aarch64-apple-darwin`,
`x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
and `x86_64-pc-windows-msvc`. Each target builds on a GitHub-hosted runner of
that platform, which installs the pinned toolchain directly because Nix does
not run on Windows. The report records each stripped size.

### Agreement of the other seven parsers

`scripts/parser-gate/parse-agreement.ts` runs the shipped adapter and
`parse <language>` over these files of each language:

- the `input.txt` of every `test-fixtures/scanner-conformance/` case;
- the files under `examples/` and `test-fixtures/diagnostics/`;
- this repository's own sources in that language.

The check passes when the candidate accepts every file the shipped adapter
accepts, on every target. Files only the candidate accepts are reported. The
issue names "worker test inputs"; the workers keep those inline in their test
sources, so this plan substitutes the repository's own sources.

### Cancellation and adversarial input

The bounds below are measured on the `x86_64-unknown-linux-gnu` runner.

- Cancellation, for Swift and Dart: one thread parses a generated 50 MB file,
  and another requests cancellation 50 ms later. The parse must return within
  100 ms of the request in each of 20 trials.
- Adversarial input, for all nine parsers. Each input must end in a result or
  a rejection within 10 s, without a crash:
  - nesting 100,000 deep, one input each for parentheses, brackets, blocks,
    and the language's closures;
  - one valid 50 MB file that repeats a declaration under unique names;
  - one 10 MB line;
  - 1 MB of random printable text.
- Corpus files: no file may exceed the same 10 s bound. The report records the
  total, median, 99th percentile, and maximum parse time, and the peak
  resident memory, for each language.

The candidate may reject input beyond a depth or size limit of its own. The
report states each limit.

## Declaration-scoped rejection

`scan --scope declaration` drops only the smallest supported declaration that
contains an error node, and the whole file when an error lies outside every
declaration. For the files the candidate rejects and the shipped worker
accepts, the report gives the symbol precision and recall of that output
against the shipped worker's. This score is outside the decision rule.

## Records

- Report: `docs/reports/<date>-parser-gate.md`, with rejection, symbol
  precision and recall, link attachment, and ranges by language, repository,
  and construct, for the development set and the final holdout separately.
- Raw records: `docs/reports/<date>-parser-gate-records.jsonl`, one line for
  every file that differs or that either implementation rejects. For the
  identical files, the report gives a count per repository and a SHA-256 over
  their sorted paths and content hashes.
- Decision record: `docs/decisions/single-binary-parser-gate.md`, listed in
  `docs/decisions/README.md`. It applies the issue's decision rule to each
  language and, for a go, lists the later slices the issue names.

## Acceptance mapping

| Acceptance criterion of the issue                                  | Delivered by |
| ------------------------------------------------------------------ | ------------ |
| Plan names corpus, parsers, fixtures, rules, and bounds beforehand | PR 1         |
| Runner drives the candidate through the fixtures                   | Slices A, B  |
| Runner compares over the whole corpus; raw records committed       | Slices C, E  |
| Nine-parser executable, cancellation, and adversarial checks       | Slice D      |
| Decision record for each language                                  | Slice E      |
| `just verify` passes; nothing registered, packaged, or released    | Slices A–E   |
