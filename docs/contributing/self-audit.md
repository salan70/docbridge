# Repository Self-Audit

This document is the policy for DocBridge's own links. `docbridge.config.json`
manages the Rust sources under `crates/` and the Markdown under `docs/specs/`,
`docs/contributing/`, and `crates/docbridge-update/`. `just validate` must
pass; `just verify` and CI run it.

## What must participate

A link belongs in the graph when the section states a contract that the file
implements:

- Normative behavior in `docs/specs/`, linked to the modules that implement
  it.
- Design and maintainer references, such as
  [Module architecture](architecture.md), [Releasing](releasing.md), and the
  update crate's README, linked to the code they describe.

Links address whole files, so link the section to the module that owns the
behavior, not to every file that touches it.

## Reviewed intentional gaps

`just unlinked` lists the code files and Markdown regions that no link covers.
These are expected and are not missing contracts:

- Tests under `crates/*/tests/`, and small entry modules such as `lib.rs` that
  only re-export.
- Contributor process documents (writing, commits, pull requests) and
  overviews whose subject is not code.
- The embedded user guides under `crates/docbridge/guides/`. They ship inside
  the CLI and are printed by `docbridge docs`, so they carry no annotations
  and stay outside `include.docs`.

Zero unlinked items is not a goal. False or low-value links are worse than a
reviewed gap.

## Semantic review

`docbridge validate` checks structure, not meaning. When a change touches a
linked file or section, run `just links <path> --include-content` and confirm
that each counterpart still agrees, or update it in the same pull request. The
pull request template's "Linked counterparts" section records the result.
