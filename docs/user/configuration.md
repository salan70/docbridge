---
description: "Configure docbridge.config.json: roots, includes, excludes, languages."
---

# Configuration

DocBridge loads `docbridge.config.json` from the project root supplied by
`--root`, or from the current directory by default. Paths and glob patterns are
interpreted relative to that root.

<!-- @code src/core/config.ts#loadConfig -->

## Loading configuration

The configuration loader requires the file, validates its schema, and rejects
source files claimed by more than one configured language.

## Minimal configuration

Declare documentation patterns and at least one supported code language:

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.schema.json",
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/**/*.ts"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Supported language keys are `typescript`, `swift`, `dart`, and `rust`. A project can
enable more than one language, each with its own patterns.

Each language accepts an optional `visibility` array. Omitting it uses the
scanner default: TypeScript `public` and `protected` members, Swift `public`
and `open`, Dart `public` only, Rust unrestricted `pub`. A declaration
excluded by visibility is not an endpoint; an `@doc` on one is
`unsupported_declaration`. See `docbridge docs show annotations` for the
per-language rules, including Dart's leading-underscore privacy.

<!-- @code src/core/glob.ts#collectFiles -->

## Excluded files

The configuration has no `exclude` property. Narrow the include patterns when
tests, fixtures, generated files, or general documentation should stay outside
the graph:

```json
{
  "include": {
    "code": {
      "typescript": {
        "patterns": ["src/domain/**/*.ts", "src/services/**/*.ts"]
      }
    },
    "docs": ["docs/specs/**/*.md"]
  }
}
```

DocBridge always ignores dependency directories, Git metadata, dot-prefixed
path segments, symbolic links, and TypeScript declaration files (`.d.ts`).
Keep patterns narrow enough that `docbridge check --audit` reports useful
coverage gaps rather than every implementation detail or general prose file.

## Validate changes

Run `docbridge check` after editing configuration. A missing, malformed, or
schema-invalid configuration produces `config_file_invalid`. Use
`docbridge init --dry-run` to inspect a safe generated starting point without
overwriting an existing file.
