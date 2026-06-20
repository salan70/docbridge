# Commit Message Convention

DocBridge uses English commit messages with both Gitmoji and Conventional Commits style prefixes.

## Format

```text
<gitmoji> <type>(<scope>): <summary>
```

Scope is optional:

```text
<gitmoji> <type>: <summary>
```

Examples:

```text
✨ feat(scanner): parse @doc annotations
🐛 fix(resolver): report missing Markdown anchors
📝 docs: document commit rules
```

## Rules

- Write commit messages in English.
- Use one Gitmoji at the beginning of the subject.
- Use a Conventional Commits type after the Gitmoji.
- Keep the summary imperative, concise, and under 72 characters when practical.
- Use a scope when it clarifies the affected area.
- Do not end the summary with a period.
- Split unrelated changes into separate commits.

## Types

- `feat`: User-facing feature or new capability
- `fix`: Bug fix
- `docs`: Documentation-only change
- `style`: Formatting or stylistic change with no behavior impact
- `refactor`: Code restructuring without feature or bug-fix intent
- `perf`: Performance improvement
- `test`: Test addition or test-only change
- `build`: Build system, package, or dependency change
- `ci`: CI configuration or workflow change
- `chore`: Maintenance change that does not fit another type
- `revert`: Revert a previous commit

## Gitmoji

Use the smallest meaningful Gitmoji set first:

- `✨` for `feat`
- `🐛` for `fix`
- `📝` for `docs`
- `✅` for `test`
- `♻️` for `refactor`
- `⚡️` for `perf`
- `💄` for `style`
- `👷` for `ci`
- `📦` for `build`
- `🔧` for `chore`
- `⏪` for `revert`

Prefer consistency over novelty. Add more Gitmoji only when the existing set does not describe the change well.

## Body

Use a body when the reason, tradeoff, or migration detail is not obvious from the subject.

```text
✨ feat(scanner): parse exported function docs

Read JSDoc comments attached to top-level exported functions and collect
@doc targets for resolver input.
```

## Breaking Changes

For breaking changes, use `!` after the type or scope and include a `BREAKING CHANGE:` footer.

```text
💥 feat(cli)!: change JSON output shape

BREAKING CHANGE: check --json now returns an object instead of an array.
```
