# vNext public contracts

DocBridge is a native Rust single-binary CLI ([#208](https://github.com/salan70/docbridge/issues/208)).
Markdown sections declare file-level links to code; the CLI validates their structure and ships offline guides.
Semantic agreement between linked text and code remains a separate review.
The CLI has no language parsers, LSP or editor integration, in-code annotations, link manifests, or backward compatibility with the npm package; migration is a deliberate manual conversion without a compatibility layer.

<!-- @code crates/docbridge/src/cli.rs -->
<!-- @code crates/docbridge/src/main.rs -->

## Commands

```sh
docbridge validate [--root <directory>] [--json]
docbridge links [--root <directory>] [--json] [--stdin] [--include-content] [selectors...]
docbridge unlinked [--root <directory>] [--json]
docbridge init [--root <directory>] [--dry-run] [--yes] [--force] [--claude]
docbridge deinit [--dry-run]
docbridge docs [list | show <name>]
```

- `validate --json` prints `diagnostics` and a `summary` with `files`, `links`, `errors`, and `complete`.
- `links` retrieves direct edges for file or section selectors (`relative/document.md#parent/child`), from arguments or stdin. A valid glob that matches nothing succeeds with an empty graph. `--include-content` adds the requested text.
- Commands that need configuration read `docbridge.config.json` from `--root` or the current directory only; they do not search upward.
- A new command must be added to the `Command` enum, the parser, and `HELP` in `crates/docbridge/src/cli.rs`, and to the embedded guides.
- The legacy `check`, `related`, `context`, `graph`, `init-with-agent`, and `lsp` commands, and the `--gate` and `--audit` flags, were removed without aliases and are rejected as unknown arguments. The migration guide (`docbridge docs show migration`) maps them to the current commands.

<!-- @code crates/docbridge/src/output.rs -->
<!-- @code crates/docbridge/src/query.rs -->

## Output model

When invoked with `--json`, query commands (`links`, `unlinked`) print one JSON object with this shape; without `--json` they print text:

```ts
type Graph = {
  nodes: Node[];
  edges: { source: string; target: string }[];
  diagnostics: { code: string; path: string; line?: number; message: string }[];
  complete: boolean;
  contents?: { id: string; path: string; start_line: number; end_line: number; text: string }[];
};
type Node = {
  id: string; // root-relative path, or path#parent/child for a section
  kind: "code" | "section";
  path: string;
  title?: string;
  level?: number;
  parents: string[];
  line: number;
  end_line: number;
  content?: { block: string; start_line: number; end_line: number };
  children?: Node[];
  regions?: { start_line: number; end_line: number }[]; // unlinked Markdown regions
};
```

IDs and ordering are deterministic and root-relative. `complete` is false when any diagnostic exists or when a managed file could not be read, so a clean-looking result is never reported for an incomplete scan.

<!-- @code crates/docbridge/src/output.rs -->
<!-- @code crates/docbridge/src/project.rs -->

## Diagnostics

Diagnostics in `validate --json`, `links --json`, and `unlinked --json`:

```ts
type QueryDiagnostic = {
  code: string;
  path: string; // root-relative; empty when no file applies
  line?: number;
  message: string;
};
```

| Code             | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `configuration`  | Missing, unreadable, or invalid `docbridge.config.json`, including unknown keys       |
| `annotation`     | An annotation is interrupted by other content or has no heading to attach to          |
| `link`           | An annotation target is missing, not a managed path, or not a code file               |
| `selector`       | A `links` selector is invalid or names a file or section that does not exist          |
| `invalid-path`   | A managed path is not valid UTF-8 or violates the managed-path rules                  |
| `unsafe-path`    | A symlink or reparse point lies inside a managed path; it is reported, never followed |
| `read-directory` | A managed directory could not be read                                                 |
| `read-file`      | A managed file is unreadable, not UTF-8, or binary                                    |
| `read-metadata`  | File metadata could not be read                                                       |
| `usage`          | Invalid CLI arguments (with `--json`, reported as a diagnostic)                       |

Any diagnostic makes the result incomplete. Exit codes: [Exit codes and query output](#exit-codes-and-query-output).

<!-- @code crates/docbridge/src/config.rs -->
<!-- @code crates/docbridge/src/project.rs -->
<!-- @code crates/docbridge/src/paths.rs -->
<!-- @code crates/docbridge/src/markdown.rs -->

## Core CLI and identity

- Section selectors use `relative/document.md#parent/child`. Each component is the heading's simple lowercase slug, retaining Unicode letters/numbers and underscores, replacing other runs with `-`, and trimming edge hyphens. This keeps the current simple rule rather than requiring GitHub compatibility.
- Parent components follow the actual nearest preceding lower-level headings; skipped heading levels create no artificial ancestors. Empty heading slugs use `section` so their children remain addressable.
- Sibling collisions receive the first available numeric suffix, beginning with `-2`, in document order. Unrelated parents may use the same component.
- Managed paths are root-relative with `/` separators. Absolute paths, `..` components, backslashes, and `#` in managed file names are rejected. Internal spaces are allowed in annotation paths. `.` is permitted only as a configuration discovery root, not as a link target.
- A link annotation is a standalone `<!-- @code path -->` line. Consecutive annotation lines and blank lines may precede its heading. Other text or comments interrupt attachment and produce diagnostics. Annotation-looking text in fenced code, other HTML comments, or CommonMark type-1 HTML blocks (`<pre>`, `<script>`, `<style>`, `<textarea>`) stays ordinary content.
- Extension matching is case-sensitive and uses the configured suffixes. Glob syntax supports segment-local `*` and recursive `**`; it does not silently add language detection or extra glob operators.
- Unknown configuration keys are errors. The initial schema has `include.code.paths`, `include.code.extensions`, `include.docs`, and optional `exclude.code`; it does not add a docs-exclude field implicitly. Empty include lists explicitly select no files of that kind.
- Canonicalize the explicitly selected project root, then reject symlinks/reparse points inside managed paths, including ancestor components. Do not follow a symlink while discovering files. Excluded entries are not managed. Unreadable files, non-UTF-8 text, or NUL-containing binary files prevent the result from being reported as complete.

<!-- @code crates/docbridge/src/cli.rs -->
<!-- @code crates/docbridge/src/query.rs -->
<!-- @code crates/docbridge/src/output.rs -->

## Exit codes and query output

| Result                                                                                                       | Exit code |
| ------------------------------------------------------------------------------------------------------------ | --------: |
| Successful command, including empty matching globs and unlinked items                                        |         0 |
| Validation/configuration/I/O failure, incomplete unlinked scan, or links with no usable result due to errors |         1 |
| links with both usable results and inconsistencies                                                           |         2 |
| Invalid CLI arguments or unknown docs guide                                                                  |         3 |

Other commands:

| Command | 0                                         | 1        | 3                              |
| ------- | ----------------------------------------- | -------- | ------------------------------ |
| `docs`  | Overview, `list`, `show <name>`, `--help` | Not used | Unknown guide or invalid usage |

- Usage errors exit 3 in every command, including `validate`.
- A nonexistent file or section, an invalid selector among several, or an unreadable file makes `links` incomplete. Return 2 when any usable result remains, otherwise 1.
- Warnings and errors go to stderr, leaving stdout valid JSON when requested.
- `links` retrieves direct edges only. A selected node can show all of its direct neighbors; neighbors do not trigger another traversal.
- With content requested, the graph retains every selected/referenced section node. Unique overlapping source ranges are merged into content blocks; nodes reference their own start/end lines in those blocks. This exposes all requested text without repeating overlapping parent/child content. Text output labels a child whose content is already present in the displayed parent.
- Code content is the complete file. Markdown content begins at the requested heading and includes descendants until the next same-or-higher heading.
- stdin contains one selector per line. Blank lines are ignored; repeated selectors are deduplicated before deciding whether the effective request is single-target or multiple-target.
- Text output with content uses separate `Links` and `Contents` sections. Treat LF and CRLF as line breaks while preserving the stored content bytes in content output.
- `unlinked` reports meaningful pre-heading or headingless content as a separate document region. A linked parent covers all descendants. When only a child is linked, report the parent's uncovered region without including the covered child as an unlinked item.
- When an unlinked section and its descendants are all unlinked, report the topmost region with descendants nested under it. A section whose only annotations are invalid is not counted as successfully linked; its diagnostics remain visible.

<!-- @code crates/docbridge/src/lifecycle.rs -->
<!-- @code crates/docbridge/src/cli_lifecycle.rs -->
<!-- @code crates/docbridge/src/docs.rs -->

## Project assets and embedded docs

- init uses `.agents/skills/docbridge/` by default and adds an optional `--claude` flag for `.claude/skills/docbridge/`.
- A small ownership record inside the skill identifies the files installed by DocBridge. This is asset ownership metadata, not a link manifest.
- Ownership entries must be relative paths confined to that skill directory and include content hashes. Reject escaping entries and symlinks without performing any removal. An old skill without a valid ownership record is unmanaged; init reports the conflict and Migration explains manual retirement first.
- `init --force` may replace recorded managed skill files, but it never overwrites configuration, follows symlinks, or deletes unrecorded user files.
- deinit shows a complete removal plan and requires interactive confirmation. Noninteractive input without confirmation fails without changes; no new deinit `--yes` or `--root` flag is added in the initial version.
- deinit removes recognizable DocBridge annotation lines outside examples and ordinary comments, preserving malformed lookalikes for manual review. It removes only owned unchanged skill files; modified or unowned files are reported and preserved. The displayed config removal requires confirmation even if the config was edited.
- init and deinit check every target against the confirmed plan before the first write and write nothing if any differs. Each file then changes in one atomic step: a write goes to a temporary file in the target's directory that is renamed over the target, keeping an existing target's permissions. There is no recovery directory.
- If a run fails partway, report which files changed and which did not, and do not claim the run succeeded. Rerunning the same command finishes the remaining work without repeating or damaging completed changes: deinit rewrites documentation first, removes each ownership record only after the files and directories it covers, and removes the configuration last; init writes an ownership record before its skill file. A directory that deinit cannot remove also fails the run.
- A file in a skill directory named exactly `.docbridge-tmp-<digits>-<digits>-<digits>` is a temporary file left by an interrupted write, not user data. It never makes a skill directory an unmanaged conflict, and init and deinit list and remove it. Files with similar names remain user files, and a file the ownership record lists follows its ownership hash instead.
- deinit displays the resolved root in its confirmation. Managed annotation targets must match discovered paths exactly, independent of filesystem case folding. Always avoid Git metadata during discovery; other hidden paths follow the explicit configuration.
- Noninteractive init without `--yes` may inspect or dry-run, but must not perform writes.
- Guides and the distributable skill are English.

## Release integrity

- Each release attaches the five executables and a `SHA256SUMS` file in `sha256sum` format that lists them.
- Each executable carries a GitHub artifact attestation of its build provenance, created by **Release vNext** from `main` in this repository.
- Users can verify a download against both the attestation and `SHA256SUMS`; the commands are in [Install](../../README.md#install).
- The CLI does not update itself. Users update through the channel they installed from.
- Targets: Linux x64/ARM64 (static musl), macOS x64/ARM64, Windows x64. Document actual supported OS requirements rather than untested minimums.
- Merging a pull request publishes nothing; a maintainer dispatches production releases. No npm/Marketplace removal or Nixpkgs submission happens merely to close an issue ([Releasing](../contributing/releasing.md)).

<!-- @code crates/docbridge/src/docs.rs -->
<!-- @code crates/docbridge/src/lifecycle.rs -->

## Skill and guide split

- The distributable Skill stays thin: it states when to use DocBridge and points to `docbridge docs`.
- The embedded guides are the source of detail (commands, migration, deinit). Do not duplicate guide content in the Skill.

## Decisions

Recorded by the maintainer on 2026-10-29:

- Release integrity relies on GitHub artifact attestations and `SHA256SUMS`; there is no project-owned signing key and no self-update ([#228](https://github.com/salan70/docbridge/issues/228)).
- init and deinit apply atomic per-file changes and finish on rerun instead of keeping a recovery directory, and every usage error exits 3, including in `validate` ([#228](https://github.com/salan70/docbridge/issues/228)).
- After release, deprecate the legacy npm package; never unpublish it.
- Nixpkgs material is prepared in this repository, and the maintainer submits it.

## Open items

- macOS signing and notarization.
- The Windows distribution format.
- Minimum supported OS versions for each target.
