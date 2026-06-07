# Configuration

SpecLink v0.1 reads an optional `speclink.config.json` file from the project root.

The project root is the current working directory by default, or the value passed to `speclink check --root <path>`.

When no config file exists, SpecLink uses this default configuration:

```json
{
  "include": {
    "code": ["src/**/*.ts"],
    "docs": ["docs/**/*.md"]
  }
}
```

When a config file exists, `include.code` and `include.docs` are required.

```json
{
  "$schema": "./schemas/speclink.schema.json",
  "include": {
    "code": ["src/**/*.ts"],
    "docs": ["docs/specs/**/*.md"]
  }
}
```

`$schema` is optional. When present, it must be a string. SpecLink does not fetch or validate the schema URL in v0.1.

Unknown top-level keys are errors, except `$schema`. Unknown keys under `include` are errors.

`include.code` and `include.docs` must be non-empty arrays of strings.

All include globs are project-root-relative POSIX-style paths. Absolute paths, `./` prefixes, `../` traversal, and `\` separators are invalid.

`include.code` patterns must end with `.ts`, but must not target `.d.ts`. `include.docs` patterns must end with `.md`.

v0.1 glob syntax supports only `*` and `**`.

- `*` matches within a single path segment and never crosses `/`.
- `**` is valid only as a full path segment.
- `?`, `[]`, `{}`, negation, and brace expansion are unsupported.

Invalid config files produce config diagnostics. If any config error exists, SpecLink does not scan project files.

<!-- @code src/core/config.ts#loadConfig -->
## Loading Configuration

Configuration loading reads `speclink.config.json` from the project root and
falls back to the default config when the file is absent.
