# AGENTS.md

Shared rules for every coding agent in this repository. Claude Code reads them
through the `@AGENTS.md` import in `CLAUDE.md`.

## Environment

- The published CLI runs on Node.js 22+ and Bun. Keep dependencies minimal, and
  prefer Bun and the TypeScript Compiler API.
- Use the `justfile` recipes. If `just` or another tool is missing, run the
  command through `nix develop -c`; this also applies when `IN_NIX_SHELL` is set
  but the environment is stale.
- To run the CLI from this checkout, use `bun run src/cli/index.ts` in place of
  `docbridge`.

## Rules

- Logic changes are test-first; follow the `tdd` skill.
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
  approval**, and merging one with a releasing label also publishes the release.
- A user's explicit instruction overrides a skill's default behavior, but not
  the approval requirements above.

## Communication

Talk with the user in the user's language. Favor accuracy and concise reasoning
over reassurance, and state opinions, risks, weak assumptions, and tradeoffs
plainly. When you report completion, list the skills and the MCP servers or
tools you used, or `None` for each.
