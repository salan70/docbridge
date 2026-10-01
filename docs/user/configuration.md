---
description: "Configure docbridge.config.json: roots, include patterns, languages, visibility."
---

# Configuration

DocBridge loads `docbridge.config.json` from the project root supplied by
`--root`, or from the current directory by default. Paths and glob patterns are
interpreted relative to that root. The exact rules for every key, pattern, and
value are in the
[Configuration specification](https://github.com/salan70/docbridge/blob/main/docs/specs/configuration.md).

<!-- @code src/config/config.ts#loadConfig -->

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

Other languages use the same shape under their own key. A Go project that
documents its `internal` packages:

```json
{
  "$schema": "./node_modules/docbridge/schemas/docbridge.schema.json",
  "include": {
    "code": {
      "go": {
        "patterns": ["internal/**/*.go"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

A project can enable more than one language, each with its own patterns, but a
source file may match only one language.

## Languages

| Key          | Files              | `visibility` values              | Default               | Scanner                   |
| ------------ | ------------------ | -------------------------------- | --------------------- | ------------------------- |
| `typescript` | `.ts`, not `.d.ts` | `public`, `protected`, `private` | `public`, `protected` | built in                  |
| `swift`      | `.swift`           | `public`, `open`, `internal`     | `public`, `open`      | `docbridge-swift-scanner` |
| `dart`       | `.dart`            | `public`                         | `public`              | `docbridge_dart_scanner`  |
| `rust`       | `.rs`              | `pub`, `private`                 | `pub`                 | `docbridge-rust-scanner`  |
| `go`         | `.go`              | `exported`, `unexported`         | `exported`            | `docbridge-go-scanner`    |

Patterns must end with the language's extension. The npm package bundles the
Swift, Dart, Rust, and Go scanners for `darwin-arm64` and `linux-x64`;
TypeScript and Markdown need no scanner binary.

Each language accepts an optional `visibility` array; omitting it uses the
default above. TypeScript `visibility` applies only to type members; top-level
declarations must be exported. Rust `pub` means unrestricted `pub`, and
`private` covers every narrower visibility. A declaration excluded by
visibility is not an endpoint. An `@doc` on an excluded TypeScript member is
`unsupported_declaration`; the Swift, Dart, Rust, and Go scanners ignore an
`@doc` on an excluded declaration without a diagnostic.
See `docbridge docs show linking` for the per-language declaration rules,
including Dart's leading-underscore privacy and Go's exported-name rule for
methods. The
[Scanning specification](https://github.com/salan70/docbridge/blob/main/docs/specs/scanning.md)
owns the exact scanner behavior and platform keys.

<!-- @code src/shared/glob.ts#collectFiles -->
<!-- @code src/config/code-language.ts#collectCodeFiles -->

## Excluded files

The configuration has no `exclude` property and no glob negation. Narrow the
positive include patterns when tests, fixtures, generated files, or general
documentation should stay outside the graph:

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

For Go, `cmd/**/*.go` and `internal/**/*.go` scan fewer files than
`**/*.go`, but `_test.go` files under them are still scanned.

DocBridge always ignores dependency directories, Git metadata, dot-prefixed
path segments, symbolic links, and TypeScript declaration files (`.d.ts`).
Keep patterns narrow enough that `docbridge check --audit` reports useful
coverage gaps rather than every implementation detail or general prose file.

## Validate changes

Run `docbridge check` after editing configuration. A missing or unreadable
file, or invalid JSON, produces `config_file_invalid`. An unknown key produces
`config_unknown_key`, and a rejected value produces `config_invalid_value`. Use
`docbridge init --dry-run` to inspect a safe generated starting point without
overwriting an existing file.

Next, read `docbridge docs show linking` to add the first links, or
`docbridge docs show commands` to choose how to check them.
