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

| Key          | Files                                                | `visibility` values                         | Default               | Scanner                   |
| ------------ | ---------------------------------------------------- | ------------------------------------------- | --------------------- | ------------------------- |
| `typescript` | `.ts`, `.tsx`, `.mts`, `.cts`, not declaration files | `public`, `protected`, `private`            | `public`, `protected` | built in                  |
| `javascript` | `.js`, `.jsx`, `.mjs`, `.cjs`                        | `public`, `protected`, `private`            | `public`, `protected` | built in                  |
| `swift`      | `.swift`                                             | `public`, `open`, `internal`                | `public`, `open`      | `docbridge-swift-scanner` |
| `dart`       | `.dart`                                              | `public`                                    | `public`              | `docbridge_dart_scanner`  |
| `rust`       | `.rs`                                                | `pub`, `private`                            | `pub`                 | `docbridge-rust-scanner`  |
| `go`         | `.go`                                                | `exported`, `unexported`                    | `exported`            | `docbridge-go-scanner`    |
| `python`     | `.py`                                                | `public`, `private`                         | `public`              | CPython 3.10 or later     |
| `ruby`       | `.rb`                                                | `public`, `protected`, `private`            | `public`              | CRuby 3.3 or later        |
| `java`       | `.java`                                              | `public`, `protected`, `package`, `private` | `public`              | JDK 17 or later           |

Patterns must end with one of the language's extensions. Each language also
accepts an optional `exclude` array that removes matched files, such as generated
code; see [Excluded files](#excluded-files). The npm package
bundles the Swift, Dart, Rust, and Go scanners for `darwin-arm64` and
`linux-x64`; TypeScript, JavaScript, and Markdown need no scanner binary.
Python, Ruby, and Java are scanned by workers in the package that run on the
interpreter or JDK installed on the machine, on any platform; see
[Scanner runtimes](#scanner-runtimes).

Each language accepts an optional `visibility` array; omitting it uses the
default above. TypeScript and JavaScript `visibility` applies only to class and
type members; top-level declarations must be exported, and every JavaScript
member is `public`. Rust `pub` means unrestricted `pub`, and `private` covers
every narrower visibility. A declaration excluded by visibility is not an
endpoint. An `@doc` on an excluded TypeScript or JavaScript member, or on an
excluded Python, Ruby, or Java declaration, is `unsupported_declaration`; the Swift,
Dart, Rust, and Go scanners ignore an `@doc` on an excluded declaration
without a diagnostic. See `docbridge docs show linking` for the per-language
declaration rules, including Dart's and Python's leading-underscore privacy,
Go's exported-name rule for methods, Ruby's `private` calls, and Java's
implicitly public interface members. The
[Scanning specification](https://github.com/salan70/docbridge/blob/main/docs/specs/scanning.md)
owns the exact scanner behavior and platform keys.

<!-- @code src/config/scanner-runtimes.ts#ScannerRuntimes -->

## Scanner runtimes

Python, Ruby, and Java files are scanned by workers that run on a runtime
installed on the machine: CPython 3.10 or later; CRuby 3.3 or later, whose
bundled Prism parses the source; and a JDK 17 or later, whose `jdk.compiler`
module parses the source. A JRE lacks that module and cannot scan Java.
DocBridge looks for `python3`, then `python` (`py -3`, then `python` on
Windows), for `ruby`, and for `java` on `PATH`, and checks each candidate
before using it. The workers never import, compile, or run project code.

To use another runtime, name it under `scanners`:

```json
{
  "include": {
    "code": { "python": { "patterns": ["src/**/*.py"] } },
    "docs": ["docs/**/*.md"]
  },
  "scanners": {
    "python": { "command": ["/opt/python3.12/bin/python3"] }
  }
}
```

`command` is the runtime executable followed by its own arguments, as an
array rather than a shell string; a relative path resolves against the project
root. A Java entry names the JDK's `java`, such as
`["/opt/jdk-21/bin/java"]`. Without a configured command, the environment
variable `DOCBRIDGE_PYTHON_RUNTIME`, `DOCBRIDGE_RUBY_RUNTIME`, or
`DOCBRIDGE_JAVA_RUNTIME` can name one runtime executable instead. A configured
command or variable is the only runtime tried: when it is missing or unusable,
the files report `code_scanner_unavailable` instead of falling back to
`PATH`.

A configured command runs with your permissions in the CLI and in the editor
extension. Review `scanners` in a repository you do not trust before running
DocBridge there.

<!-- @code src/shared/glob.ts#collectFiles -->
<!-- @code src/config/code-language.ts#collectCodeFiles -->

## Excluded files

Use `exclude` in a language entry to remove matched files that should not be
managed, such as generated code. Flutter's `build_runner` outputs `*.g.dart` and
`*.freezed.dart` are the usual case:

```json
{
  "include": {
    "code": {
      "dart": {
        "patterns": ["lib/**/*.dart"],
        "exclude": ["lib/**/*.g.dart", "lib/**/*.freezed.dart"]
      }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Each `exclude` pattern follows the `patterns` rules and must end with the
language's extension. The configuration has no glob negation, so `exclude` is the
only way to remove files that `patterns` matches. Narrow the positive include
patterns when tests, fixtures, or general documentation should stay outside the
graph:

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
`**/*.go`, but `_test.go` files under them are still scanned. For Python,
Ruby, and Java, keep test directories such as `tests/`, `spec/`, and
`src/test/` outside the patterns in the same way; in a Maven or Gradle layout,
`src/main/java/**/*.java` does.

DocBridge always ignores dependency directories, Git metadata, dot-prefixed
path segments, symbolic links, and TypeScript declaration files (`.d.ts`,
`.d.mts`, and `.d.cts`).
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
