# Configuration

SpecLink reads a required `speclink.config.json` file from the project root.

The project root is the current working directory by default, or the value passed to `speclink check --root <path>`.

The configuration file is required. When it is absent, SpecLink reports `config_file_invalid` and does not scan project files. There is no implicit default configuration.

```json
{
  "$schema": "./schemas/speclink.schema.json",
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/specs/**/*.md"]
  }
}
```

`$schema` is optional. When present, it must be a string. SpecLink does not fetch or validate the schema URL.

Unknown top-level keys are errors, except `$schema`. Unknown keys under `include` are errors.

`include.code` and `include.docs` are required. `include.docs` must be a non-empty array of strings.

All include globs are project-root-relative POSIX-style paths. Absolute paths, `./` prefixes, `../` traversal, and `\` separators are invalid.

`include.docs` patterns must end with `.md`.

v0.1 glob syntax supports only `*` and `**`.

- `*` matches within a single path segment and never crosses `/`.
- `**` is valid only as a full path segment.
- `?`, `[]`, `{}`, negation, and brace expansion are unsupported.

Invalid config files produce config diagnostics. If any config error exists, SpecLink does not scan project files.

<!-- @code src/core/code-language.ts#CodeIncludeEntry -->
## Code Languages

`include.code` is a language-keyed object, not an array. Each key is a fixed
lowercase code language ID, and each value is an object configuring that
language. Shorthand pattern arrays such as `"swift": ["Sources/**/*.swift"]` are
not supported; the old array form `"code": ["src/**/*.ts"]` is invalid.

Supported language IDs are `typescript`, `swift`, and `dart`. Any other key is an
error.

```json
{
  "include": {
    "code": {
      "typescript": { "patterns": ["src/**/*.ts"] },
      "swift": {
        "patterns": ["Sources/**/*.swift"],
        "visibility": ["public", "open", "internal"]
      },
      "dart": { "patterns": ["lib/**/*.dart"], "visibility": ["public"] }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Each entry requires a non-empty `patterns` array of strings. Patterns must end
with the language extension: `.ts` for `typescript` (but not `.d.ts`), `.swift`
for `swift`, and `.dart` for `dart`. An optional `visibility` array narrows the
audited public surface; allowed values are validated per language adapter.
Swift accepts `public`, `open`, and `internal`; omitting `visibility` scans
`public` and `open`. Dart accepts `public`. TypeScript does not accept
`visibility` and keeps its exported top-level declaration rules.

If the same code file matches the patterns of more than one configured language,
configuration is invalid (`config_invalid_value`): every code file must belong
to exactly one language.

<!-- @code src/core/config.ts#loadConfig -->
## Loading Configuration

Configuration loading reads `speclink.config.json` from the project root and
reports an error when the file is absent. When the parsed config is otherwise
valid, the managed code files are collected to reject any file claimed by more
than one configured language.
