# Pull Request Convention

DocBridge lands every change through a pull request that is merged with a
**Create a merge commit**. This document is the normative source for branch
names and pull request titles. Commit subjects follow
[Commit messages](commits.md) and are a separate convention.

## Branch naming

```text
<feat|fix|chore>/#<issue>-<kebab-desc>
<feat|fix|chore>/<kebab-desc>
```

Examples:

```text
feat/#42-version-flag
fix/#51-anchor-resolution
chore/#75-rename-scanner-executables
chore/agent-environment-inventory
```

Rules:

- Use `feat/`, `fix/`, or `chore/` for ordinary work. The precise change type
  lives in the commit message and pull request title, not the branch prefix.
- Include `#<issue>` when the branch resolves an issue, so the branch visibly
  names it. Omit it when no issue exists.
- Dependabot branch names (`dependabot/...`) are outside repository control.

Encode the `#` as `%23` in hand-written GitHub URLs that embed a branch name.

## Pull request title

```text
<gitmoji> <type>: <summary>
```

Examples:

```text
📝 docs: define pull request title and branch naming conventions
🐛 fix: preserve scanner executable bit in npm package
✨ feat: support the Node.js runtime for the npm package
```

Rules:

- Write titles in English.
- Use one Gitmoji and a Conventional Commits type. Reuse the type and Gitmoji
  tables in [Commit messages](commits.md); do not invent a parallel set here.
- Do **not** include a scope. Scope belongs in commit subjects when useful.
- Keep the summary imperative, concise, and under 72 characters when practical.
- Do not end the summary with a period.
- Describe the **whole pull request**, not its first commit. A PR that mixes
  `fix`, `docs`, and `test` commits still needs one title that covers the
  overall change.
- Do **not** put the issue number in the title. GitHub does not autolink `#NN`
  in titles, and the pull request body already carries a plain-text closing
  keyword (see [Linking issues](#linking-issues)).

## Pull request body

Follow the repository [Writing Guidelines](writing.md) and the pull request
template. Summarize the delivered result in no more than three bullets. When
the pull request resolves an issue, link it instead of repeating its background
or acceptance criteria. Without an issue, state the problem the pull request
solves.

Record only checks that actually ran. Keep Review notes only for decisions or
deviations not captured by the issue, remaining risks, or focused review
guidance. Keep Linked counterparts only for actual gate findings and their
content-based disposition.

## Release label

Every pull request carries exactly one `release:` label: `release: none`,
`release: patch`, `release: minor`, or `release: major`. A releasing label
requires the version bump and CHANGELOG roll from `just release-bump <kind>` in
the same pull request, and merging it publishes that release. The required
`release-label` check enforces the label and the matching change. The
[git-workflow skill](../../.claude/skills/git-workflow/SKILL.md#releases-per-pr)
defines when to use each kind.

## Linking issues

A pull request that resolves an issue links it with a GitHub closing keyword
in the pull request body:

```text
Closes #123
```

Rules:

- Write the keyword as **plain text** in the body (for example
  `- Closes #123`). Do **not** wrap it in backticks or a fenced code block.
  GitHub ignores closing keywords inside code spans, so `` `Closes #123` ``
  will not auto-close the issue on merge.
- Put the issue number in the body, not in the pull request title.
- Prefer `Closes` for work that should close the issue. Other GitHub closing
  keywords (`Fixes`, `Resolves`) are also accepted when they fit.

## Documented exceptions

- **Dependabot PRs** already emit Gitmoji-plus-type titles (for example
  `👷 ci: bump actions/checkout from 7.0.0 to 7.0.1`). Leave them as generated.

Branch names and pull request titles are documentation-only conventions. No CI
check, workflow, or `justfile` recipe enforces them.
