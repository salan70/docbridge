# AGENTS.md

Shared rules for every coding agent in this repository.
Contributor procedures are owned by [CONTRIBUTING.md](docs/CONTRIBUTING.md):
[Verification](docs/CONTRIBUTING.md#verification),
[Git and pull requests](docs/CONTRIBUTING.md#git-and-pull-requests), and
[Documentation](docs/CONTRIBUTING.md#documentation).

## Environment

- DocBridge is a native Rust CLI built from the Cargo workspace in `crates/`
  with the toolchain pinned by `rust-toolchain.toml`. Keep dependencies
  minimal and pinned through `Cargo.lock`.
- Use the `justfile` recipes. If `just` or another tool is missing, run the
  command through `nix develop -c`; this also applies when `IN_NIX_SHELL` is set
  but the environment is stale.
- To run the CLI from this checkout, use `cargo run -p docbridge --` in place of
  `docbridge`. `just validate`, `just links`, and `just unlinked` run it on this
  repository.

## Rules

- Logic changes are test-first: write a regression test, observe the expected
  failure before implementation, make the smallest passing change, and refactor
  only while green. Never skip or weaken tests to pass. For uncovered
  behavior-preserving refactors, add characterization coverage first.
  Follow [test conventions](docs/CONTRIBUTING.md#test-conventions) and report
  observed RED/GREEN results.
- Run `just verify` on changed work before you report completion.
- Fix the underlying code instead of weakening a quality gate. Get explicit
  user approval for each specific exception before you add a lint or formatter
  suppression, disable or downgrade a rule, expand an ignore or exclusion, or
  raise a complexity, size, depth, or parameter limit.
- Write deliverables in English, including documentation, code comments,
  commits, and pull requests. Use Japanese only for content marked as Japanese,
  such as files under `docs/ja/`.
- Agents may branch, commit, push, and open pull requests through the
  `git-workflow` skill. **Merging a pull request requires explicit human
  approval.** Releases are published only when a maintainer dispatches
  Release vNext.
- A user's explicit instruction overrides a skill's default behavior, but not
  the approval requirements above.

## Communication

Talk with the user in the user's language. Favor accuracy and concise reasoning
over reassurance, and state opinions, risks, weak assumptions, and tradeoffs
plainly. When you report completion, list the skills and the MCP servers or
tools you used, or `None` for each.

## Writing and review

- Lead with the result, evidence, and next action. Link to the source of truth
  instead of repeating it; follow the repository's issue and PR templates.
- Preserve safety boundaries, compatibility, failure behavior, and observed
  verification results. Never invent facts to fill a template.
- Review concrete failure modes, regressions, contracts, and security risks;
  verify behavior-dependent findings and anchor them to the responsible line.
- Evaluate review suggestions on their merits, reproduce defects before fixing
  them, and explain either the verified fix or the reason for no change.
- When review feedback requires a scope, security, or compatibility decision,
  ask the user. When authorized to handle GitHub feedback, reply to and resolve
  each thread after addressing it; do not approve unresolved findings.
