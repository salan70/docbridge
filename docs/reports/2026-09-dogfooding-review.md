# Dogfooding Review, September 2026

This report records how DocBridge is used in practice as of 2026-09-16, what it
delivered, which shipped surfaces went unused, and which changes the evidence
supports. It is a dated observation, not current guidance. Improvement
candidates become issues only after review; see
[#144](https://github.com/salan70/docbridge/issues/144).

## Scope and method

Three read-only surveys were combined:

- This repository: version 0.8.0, the nine CLI subcommands, the shipped
  integration assets, and the repository's own gate setup.
- Five adopter repositories on the maintainer's machine: `yodoku` (Swift),
  `teigiii_app` (Dart and TypeScript), `share-expenses` (Swift), `389-app`
  (Dart and TypeScript), and `cornix-bonsai` (TypeScript). Each was inspected
  for configuration, pinned version, invocation recipes, hooks, skills,
  annotation counts, and Git history.
- Claude Code and Codex session logs for those repositories and this one. Every
  agent-issued `docbridge` command, skill invocation, hook message, diagnostic
  code, and user statement mentioning DocBridge was tallied.

Counts from the session logs are per session file, de-duplicated where Codex
records the same event twice. Editor and Language Server use does not appear in
agent transcripts, so the review says nothing about it either way.

## Adopters

| Repository       | Version                           | Local gate                             | CI                            | Agent hooks          | Skills                          | `@doc` / `@code` | Commits touching `@doc` | Last annotation commit          |
| ---------------- | --------------------------------- | -------------------------------------- | ----------------------------- | -------------------- | ------------------------------- | ---------------- | ----------------------- | ------------------------------- |
| `yodoku`         | 0.4.1, local `node_modules`       | pre-push, blocking                     | none                          | none                 | 1 copy, 0.4.x                   | 55 / 55          | 22                      | 2026-07-27 (repository's last)  |
| `teigiii_app`    | 0.5.2, `bunx`, pinned in 4 places | none                                   | `check` blocks, gate advisory | PostToolUse and Stop | 5 + 2 copies, 0.5.x, translated | 58 / 59          | 20                      | 2026-08-10 (repository active)  |
| `share-expenses` | 0.4.1, `bunx` via Nix app         | none (Stop hook advisory)              | none                          | Stop                 | 5 + 5 copies, 0.4.x, drifted    | 56 / 57          | 2                       | 2026-06-24 (repository dormant) |
| `389-app`        | 0.5.2, `bunx`                     | none                                   | copy of `teigiii_app`         | none                 | 5 + 5 copies, 0.5.x, edited     | 11 / 11          | 3                       | 2026-08-17 (repository active)  |
| `cornix-bonsai`  | 0.8.0, `.docbridge-version`       | pre-commit blocking, pre-push advisory | same shape, `npx`             | none, by policy      | 1 unified skill, 0.8.0          | 139 / 127        | 35                      | 2026-09-13 (repository's last)  |

Two repositories still carry workarounds for defects fixed upstream.
`yodoku` re-applies the executable bit to `speclink-*` scanners before every
run, and `share-expenses` searches the `bunx` cache to do the same. Both defects
were fixed in [#74](https://github.com/salan70/docbridge/issues/74) and
[#75](https://github.com/salan70/docbridge/issues/75); neither repository
upgraded.

## Command use

Agent-issued invocations across the five adopters:

| Command                   | Invocations | Where                                     |
| ------------------------- | ----------- | ----------------------------------------- |
| `check`                   | about 330   | all; about 95% through a `just` recipe    |
| `related --gate`          | about 60    | `teigiii_app`, `cornix-bonsai`, `389-app` |
| `context`                 | 36          | `cornix-bonsai` 28, `teigiii_app` 8       |
| `docs list` / `docs show` | about 33    | `cornix-bonsai` only                      |
| `graph`                   | about 15    | `share-expenses` semantic audit           |
| `check --audit`           | 13          | `cornix-bonsai` only                      |
| `check --json`            | 0           | 4 uses, all in this repository            |
| `lsp`                     | 0           | 50 uses, all in this repository           |

`check` is green about 90% of the time in steady state and 20 of 20 times in
`389-app`. `related --gate` reports at least one unchanged counterpart on 29 of
32 runs in `teigiii_app` and 14 of 16 in `cornix-bonsai`. The usual response is
a per-counterpart "no update needed" section in the pull request body, written
after the agent read each counterpart.

Skills were installed in every adopter, in up to ten copies, and invoked five
times in total: one `docbridge`, one `docbridge-sync`, and three
`/docbridge-adopt` during one adoption session. Sessions that synchronized
vendored skill copies against the template outnumber sessions that used a skill.

Agent hooks were wired in `teigiii_app` and `share-expenses`. No hook output
appears in any recorded transcript. This repository removed hooks in
[#106](https://github.com/salan70/docbridge/issues/106), and `389-app` had to
rewrite its `docbridge-sync` copy because the Stop-hook input it assumed no
longer exists.

## What DocBridge delivered

1. **Semantic audit in `share-expenses` (2026-06-24).** With `check` reporting
   0 errors and 0 warnings, an agent walked the 56 bidirectional pairs from
   `graph --json --include-content` and found eight real divergences between
   specification and implementation. Two were behavior bugs: a budget ring
   clamped at 300% where the specification forbids a cap, and an unpause path
   that leaves a stale anchor date. This is the strongest outcome in the
   corpus, and it did not use `check`.
2. **A stale specification caught by the gate in `389-app` (2026-08-17).**
   `related --gate` listed a `design.md` section whose linked class no longer
   existed. A reviewer noted that the next reader would implement against a
   missing class; the document was updated in the same pull request.
3. **A dense, growing graph where the local gate blocks.** `cornix-bonsai` runs
   a blocking `check` at pre-commit (measured under 0.5 seconds for about 500
   files) and an advisory gate at pre-push. It has 2.4 times the `@doc` count
   of the next adopter, annotations change in 35 feature commits, and no
   commit ever fixes a broken link because breakage never reaches history.
4. **Annotations move with features.** In `yodoku` and `cornix-bonsai`, `@doc`
   and `@code` change inside ordinary feature commits, not in cleanup commits.
5. **Durable team decisions attached to links.** `teigiii_app` recorded which
   documents are provisional link targets and which short-lived code must not
   be linked. `yodoku` recorded annotation rules after rediscovering them; its
   note says every rule was already specified and tested here.

## What went unused

- **Agent hooks.** Built, shipped, never observed firing, then removed
  upstream. Two adopters still carry them.
- **Skills as a delivery mechanism.** Installed everywhere, invoked five times.
  Vendored copies drift by version and by language. The `cornix-bonsai` copy of
  the 0.8.0 skill references `agent-integration`, `linking-workflow`,
  `annotations`, and `link-review`, which are deprecated aliases scheduled for
  removal in [#129](https://github.com/salan70/docbridge/issues/129).
- **Version currency.** Four versions in use; only `cornix-bonsai` has one
  version source and a documented upgrade step. The others duplicate the pin
  in up to four files.
- **Adoption depth in `389-app`.** Eleven links across 457 Dart files, CI
  always green, no local gate. Installation without a local gate produced no
  growth in five weeks of active development.
- **`check --json`, `graph` outside audits, `--audit` outside `cornix-bonsai`,
  and the Language Server outside this repository.** Low cost to keep; `graph`
  and JSON output are the substrate of the semantic audit above.

## Friction catalogue

| Id  | Observed problem                                                                                      | Upstream status                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| F1  | Bundled scanners lost the executable bit; `code_scanner_unavailable` via `bunx`                       | Fixed at pack time in 0.4.1                                                                                      |
| F2  | The `bunx` cache is on a `noexec` mount, so a correct scanner still cannot run                        | Diagnosed message and guidance in #74; `yodoku` moved off `bunx` permanently                                     |
| F3  | `bun install` drops the executable bit again on a local pin                                           | Fixed in #74; `yodoku` stays on 0.4.1 and re-applies `chmod` before each run                                     |
| F4  | `code_scanner_failed` during adoption in Swift and TypeScript repositories                            | Individual causes not recorded                                                                                   |
| F5  | The CI sticky comment contained tool chatter (`nix develop` and `bunx` output)                        | Fixed in `teigiii_app`; the shipped recipe still merges stderr into the comment body (`docs/integrations/ci.md`) |
| F6  | An adopter piped `related --gate` through `tail`, so the reported exit status was always 0            | Recipe hazard; the shipped recipe captures the status before any pipe                                            |
| F7  | `EBADENGINE` warnings on Node below 22; every `cornix-bonsai` command filters them                    | Runtime requirement is documented; noise remains                                                                 |
| F8  | Generated Dart files (`.freezed.dart`) duplicate doc comments; `include` has no exclusion or negation | Open; `docs/specs/configuration.md` states negation is unsupported                                               |
| F9  | `init --yes` created `.agents/skills/` when no agent directory existed                                | Raised by the maintainer on 2026-06-21; unchanged                                                                |

Backlink diagnostics dominate adopter time: `doc_backlink_not_found` appears in
44 `teigiii_app` session files and `code_backlink_not_found` in 26
`cornix-bonsai` files. The reciprocal requirement is the main authoring cost,
which [#143](https://github.com/salan70/docbridge/issues/143) targets.

Maintainer statements that frame the same points, in order of date:

- 2026-07-15: the CI comment "looks a bit strange", which led to F5.
- 2026-08-17: ideally DocBridge is usable "without relying on skills"; this
  led to [#124](https://github.com/salan70/docbridge/issues/124).
- 2026-08-18: asked whether `check` is fast enough for pre-commit; the measured
  answer became the `cornix-bonsai` setup.
- 2026-09-16: a "stealth mode" with no comments would remove the adoption
  hurdle; this became #143.

## Improvement candidates

Ranked by evidence weight. Each names the suggested issue form.

1. **Recommend a blocking pre-commit `check` and an advisory pre-push gate as
   the default local recipe** (Documentation issue). `docs/user/automation.md`
   describes hooks in general terms. The one adopter with this setup has the
   only growing graph; the one with CI alone has eleven links. State the
   measured cost.
2. **Define one version source and an upgrade path** (Documentation issue,
   then Feature proposal if a check is added). Document the
   `.docbridge-version` pattern and add `docbridge upgrade --check` to the CI
   recipe so stale pins and stale skills are reported before #129 removes the
   aliases the vendored skills use.
3. **Make gate justifications checkable** (Feature proposal). The gate is
   informational and nothing verifies that a justification exists; in
   `389-app` a reviewer noticed the missing justification by hand. Options: the
   CI recipe requires a `docbridge-related-gate` section in the pull request
   body when the outcome is `violation`, or `related --gate` accepts an
   acknowledgement list.
4. **Add exclusion patterns to `include`** (Feature proposal). F8 forces
   adopters to avoid annotating any class that a generator copies.
5. **Offer a Markdown form of `graph --include-content`** (Feature proposal).
   The semantic review in `docs/user/linking.md` is documented but was
   executed once, from JSON. A prompt-ready listing of every pair, in the style
   of `context`, lowers the cost of repeating the audit that produced the best
   outcome.
6. **Make `init --yes` default to no agent target when no agent directory
   exists** (Bug report or Feature proposal). F9.
7. **Separate stderr from the sticky comment body in the CI recipe**
   (Documentation issue). F5 and F6.
8. **Surface audit counts in the CI comment** (Feature proposal). A green
   `check` at eleven links says nothing. One informational line with
   `undocumented_symbol` and `unlinked_doc_section` counts gives adopters a
   growth signal without a blocking gate.
9. **Defer editor investment until an adopter reports editor use** (decision,
   no issue). [#56](https://github.com/salan70/docbridge/issues/56) can wait
   for one data point.

Adopter-side follow-ups outside this repository: remove the lingering hooks in
`teigiii_app` and `share-expenses`, upgrade `yodoku` and `share-expenses` past
0.6.1 and delete their `chmod` workarounds, and replace the ten-copy skill trees
with the single `docbridge` skill.

## Method limits

- Transcripts show agent-issued commands only. Manual terminal use and editor
  use are invisible.
- Counts are files containing a string, not events; a long session counts once.
- Diagnostic-code counts from this repository and its predecessor were
  excluded because the source tree contains every code as a literal.
- Adopter repositories are private. This report cites repository names,
  repository-relative paths, dates, and short maintainer statements only.

## Follow-up, 2026-09-23

This section records changes after the review. The observations above are
unchanged.

- [#129](https://github.com/salan70/docbridge/issues/129) is resolved by
  [#147](https://github.com/salan70/docbridge/pull/147). Former guide names
  now fail as unknown names, so vendored 0.8.0 skills need
  `docbridge upgrade --force`.
- [#143](https://github.com/salan70/docbridge/issues/143) is resolved by
  [#146](https://github.com/salan70/docbridge/pull/146), which adds the
  `docbridge.links.json` link manifest.
- F9 and improvement candidate 6 were already fixed before this review:
  since 2026-06-21, `init --yes` selects no agent target when no agent
  directory exists (`src/setup/init-discovery.ts`). The adopter observation
  predates that fix.
- [#148](https://github.com/salan70/docbridge/issues/148) updates the CI
  recipe for F5 and improvement candidates 2 and 7. This repository's own
  workflow still merges stderr into the gate output.
