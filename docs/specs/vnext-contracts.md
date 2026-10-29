# vNext public contracts

The user accepted these resolutions of the open questions in #209–#215 on 2026-10-29.
The original confirmed requirements remain binding.
The maintainer decided production key custody, the first vNext version, legacy npm handling, and Nixpkgs submission on 2026-10-29 (see Decisions); actually generating keys, publishing, and submitting remain manual maintainer steps.
Internal module layout, algorithms, and crate selection remain implementation decisions.

## Core CLI and identity

- Section selectors use `relative/document.md#parent/child`. Each component is the heading's simple lowercase slug, retaining Unicode letters/numbers and underscores, replacing other runs with `-`, and trimming edge hyphens. This keeps the current simple rule rather than requiring GitHub compatibility.
- Parent components follow the actual nearest preceding lower-level headings; skipped heading levels create no artificial ancestors. Empty heading slugs use `section` so their children remain addressable.
- Sibling collisions receive the first available numeric suffix, beginning with `-2`, in document order. Unrelated parents may use the same component.
- Managed paths are root-relative with `/` separators. Absolute paths, `..` components, backslashes, and `#` in managed file names are rejected. Internal spaces are allowed in annotation paths. `.` is permitted only as a configuration discovery root, not as a link target.
- A link annotation is a standalone `<!-- @code path -->` line. Consecutive annotation lines and blank lines may precede its heading. Other text or comments interrupt attachment and produce diagnostics. Annotation-looking text in fenced code, other HTML comments, or CommonMark type-1 HTML blocks (`<pre>`, `<script>`, `<style>`, `<textarea>`) stays ordinary content.
- Extension matching is case-sensitive and uses the configured suffixes. Glob syntax supports segment-local `*` and recursive `**`; it does not silently add language detection or extra glob operators.
- Unknown configuration keys are errors. The initial schema has `include.code.paths`, `include.code.extensions`, `include.docs`, and optional `exclude.code`; it does not add a docs-exclude field implicitly. Empty include lists explicitly select no files of that kind.
- Canonicalize the explicitly selected project root, then reject symlinks/reparse points inside managed paths, including ancestor components. Do not follow a symlink while discovering files. Excluded entries are not managed. Unreadable files, non-UTF-8 text, or NUL-containing binary files prevent the result from being reported as complete.

## Exit codes and query output

| Result                                                                                                       | Exit code |
| ------------------------------------------------------------------------------------------------------------ | --------: |
| Successful command, including empty matching globs and unlinked items                                        |         0 |
| Validation/configuration/I/O failure, incomplete unlinked scan, or links with no usable result due to errors |         1 |
| links with both usable results and inconsistencies                                                           |         2 |
| Invalid CLI arguments or unknown docs guide                                                                  |         3 |

Per-command notes for the commands that do not query the graph:

| Command   | 0                                                                                             | 1                                                                                                                                            | 3                                     |
| --------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `upgrade` | Updated, update available (`--check`/`--dry-run`), already current, or declined interactively | Verification, provenance, network, lock, or recovery failure; confirmation required without a terminal and without `--yes` (nothing written) | Unknown argument or other usage error |
| `docs`    | Overview, `list`, `show <name>`, `--help`                                                     | Not used                                                                                                                                     | Unknown guide or invalid usage        |

- Exception: preserve the confirmed `validate` contract strictly; its argument errors also return 1. Exit code 3 applies to usage errors in the other commands.
- Plain nonexistent file selectors are errors; a valid glob matching nothing succeeds with an empty graph.
- A nonexistent section, invalid selector among several selectors, or unreadable file makes `links` incomplete. Return 2 when any usable result remains, otherwise 1.
- Warnings and errors go to stderr, leaving stdout valid JSON when requested.
- `validate --json` returns diagnostics and summary. Query JSON includes `nodes`, `edges`, `diagnostics`, and a `complete` flag. IDs and ordering are deterministic and root-relative.
- `links` retrieves direct edges only. A selected node can show all of its direct neighbors; neighbors do not trigger another traversal.
- With content requested, the graph retains every selected/referenced section node. Unique overlapping source ranges are merged into content blocks; nodes reference their own start/end lines in those blocks. This exposes all requested text without repeating overlapping parent/child content. Text output labels a child whose content is already present in the displayed parent.
- Code content is the complete file. Markdown content begins at the requested heading and includes descendants until the next same-or-higher heading. Text is never summarized or truncated.
- stdin contains one selector per line. Blank lines are ignored; repeated selectors are deduplicated before deciding whether the effective request is single-target or multiple-target.
- Text output with content uses separate `Links` and `Contents` sections. Treat LF and CRLF as line breaks while preserving the stored content bytes in content output.
- `unlinked` reports meaningful pre-heading or headingless content as a separate document region. A linked parent covers all descendants. When only a child is linked, report the parent's uncovered region without including the covered child as an unlinked item. Invalid links do not make an incomplete scan look complete.
- When an unlinked section and its descendants are all unlinked, report the topmost region with descendants nested under it. A section whose only annotations are invalid is not counted as successfully linked; its diagnostics remain visible.

## Project assets and embedded docs

- init uses `.agents/skills/docbridge/` by default and adds an optional `--claude` flag for `.claude/skills/docbridge/`.
- A small ownership record inside the skill identifies the files installed by DocBridge. This is asset ownership metadata, not a link manifest.
- Ownership entries must be relative paths confined to that skill directory and include content hashes. Reject escaping entries and symlinks without performing any removal. An old skill without a valid ownership record is unmanaged; init reports the conflict and Migration explains manual retirement first.
- `init --force` may replace recorded managed skill files, but it never overwrites configuration, follows symlinks, or deletes unrecorded user files.
- deinit shows a complete removal plan and requires interactive confirmation. Noninteractive input without confirmation fails without changes; no new deinit `--yes` or `--root` flag is added in the initial version.
- deinit removes recognizable DocBridge annotation lines outside examples and ordinary comments, preserving malformed lookalikes for manual review. It removes only owned unchanged skill files; modified or unowned files are reported and preserved. The displayed config removal requires confirmation even if the config was edited.
- Preflight removal targets before writes, retain enough original content for recovery, and report failure explicitly if removal or recovery cannot finish. Do not claim a partial removal succeeded completely.
- Use temporary-file rewrites and atomic replacement per file. Keep a persistent, private recovery directory for originals until removal finishes; if interrupted, identify changed and untouched files and the recovery path. Never overwrite or delete a pre-existing recovery directory.
- Without `--root`, commands that require project configuration use the current directory only; do not search upward. deinit displays the resolved root in its confirmation. Managed annotation targets must match discovered paths exactly, independent of filesystem case folding. Always avoid Git metadata during discovery; other hidden paths follow the explicit configuration.
- Noninteractive init or upgrade without `--yes` may inspect or dry-run, but must not perform writes or replacement.
- Bare `docs` shows a short getting-started entry and available guides. `docs list` lists guide names; `docs show <name>` displays one guide. Guides and the distributable skill are English initially.

## Signing and release preparation

- The executable verifies a signed manifest binding schema version, release version, target, filename, SHA-256, and key ID. It may bundle multiple trusted Ed25519 public keys. Verify the manifest with the identified trusted key before assets can replace the installed binary.
- The signed version must match the selected release tag and be newer than the running version. Reject replay, downgrade, and version/target mismatch before replacement.
- Production keys follow the Decisions section: the private key is held only in the protected `release` environment, and the binary trusts a compiled-in primary and an offline backup public key. Until the maintainer provisions them, test and verify with test-only keys; do not invent a production key or weaken verification to make release tests pass.
- Unknown install provenance never triggers self-replacement. Managed installations receive commands appropriate to their package manager; detection does not depend on the current directory.
- Positive standalone identification requires a receipt created by the documented standalone installation procedure, bound to the executable path and installed hash. Known managed installation locations take precedence over such a receipt. Direct downloads without a receipt receive installation/update guidance instead of self-replacement.
- `upgrade --check` and `--dry-run` never replace the executable. A newer stable version is reported without treating availability itself as a command failure. Failed verification remains an error.
- Download and verify in the executable's directory, retain the old executable as a recoverable backup, and replace using platform-appropriate atomic operations. On Windows, safely rename the running binary aside before moving the verified replacement into place and defer safe cleanup. Restore on failure where possible; any restoration failure reports the recovery paths instead of claiming success.
- Prepare Linux x64/ARM64 as static musl builds for portability, macOS x64/ARM64, and Windows x64. Document actual supported OS/toolchain requirements rather than claiming untested minimum versions.
- Keep production release invocation manual during cutover. Preparatory internal PRs use the repository's non-releasing path; the final user-facing cutover must satisfy versioning and release-label checks. No production publishing, npm/Marketplace removal, or Nixpkgs submission is performed merely to close an issue.
- Nixpkgs packaging is built from Rust source. Prepare and verify the package and submission material; record any external approval or acceptance that remains outstanding instead of closing it as completed.

## Skill and guide split

- The distributable Skill stays thin: it states when to use DocBridge and points to `docbridge docs`.
- The embedded guides are the source of detail (commands, migration, deinit). Do not duplicate guide content in the Skill.

## Decisions

Recorded by the maintainer on 2026-10-29:

- The production signing key lives in a protected `release` GitHub Actions environment secret that requires reviewer approval. The executable compiles in a primary public key and an offline backup public key.
- The first vNext version is 0.17.0.
- After release, deprecate the legacy npm package. Never unpublish it.
- Nixpkgs material is prepared in this repository, and the maintainer submits it.

## Open items

- macOS signing and notarization.
- The Windows distribution format.
- Minimum supported OS versions for each target.

## Merge intent

The user's current request authorizes merging completed implementation PRs when checks and the required cross-family reviews pass.
Use merge commits and do not bypass branch protection.
Any production publication or external operation that remains undecided is reported separately and is not implied by a successful implementation merge.
