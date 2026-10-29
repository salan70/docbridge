# AGENTS.md

Shared rules for every coding agent in this repository.
Contributor procedures are owned by [Contributor guide](docs/contributing/README.md):
[Verification](docs/contributing/README.md#verification),
[Git and pull requests](docs/contributing/README.md#git-and-pull-requests), and
[Documentation](docs/contributing/README.md#documentation).

## Environment

- Keep dependencies minimal and pinned through `Cargo.lock`.
- Use the `justfile` recipes. If `just` is missing or the shell is stale
  (including when `IN_NIX_SHELL` is set), prefix the command with `nix develop -c`.
- In this checkout, `cargo run -p docbridge --` replaces `docbridge`.

## Rules

- Logic changes are test-first; follow
  [test conventions](docs/contributing/README.md#test-conventions) and report
  observed RED/GREEN results.
- Run `just verify` on changed work before you report completion.
- Fix the underlying code instead of weakening a quality gate. Get explicit
  user approval for each specific exception before you add a lint or formatter
  suppression, disable or downgrade a rule, expand an ignore or exclusion, or
  raise a complexity, size, depth, or parameter limit.
- Write deliverables in English, including documentation, code comments,
  commits, and pull requests. Use Japanese only for content explicitly marked
  as Japanese.
- Agents may branch, commit, push, and open pull requests through the
  `git-workflow` skill. **Merging a pull request requires explicit human
  approval.** Only a maintainer publishes a release; see
  [Releasing](docs/contributing/releasing.md).
- A user's explicit instruction overrides a skill's default behavior, but not
  the approval requirements above.

## Communication

- Talk with the user in the user's language.
- When you report completion, list the skills and the MCP servers or tools you
  used, or `None` for each.
- When review feedback requires a scope, security, or compatibility decision,
  ask the user. When authorized to handle GitHub feedback, reply to and resolve
  each thread after addressing it; do not approve unresolved findings.
