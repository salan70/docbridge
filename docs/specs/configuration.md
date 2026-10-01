<!-- @code src/config/config.ts#DocBridgeConfig -->

# Configuration

DocBridge reads a required `docbridge.config.json` file from the project root.

The project root is the current working directory by default, or the value passed to `--root <path>` on `check`, `related`, `context`, or `graph`.

The configuration file is required. When it is absent, cannot be read, or is not valid JSON, DocBridge reports `config_file_invalid` and does not scan project files. There is no implicit default configuration.

```json
{
  "$schema": "./schemas/docbridge.schema.json",
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

`$schema` is optional. When present, it must be a string. DocBridge does not fetch or validate the schema URL.

The parsed value must be a JSON object; otherwise DocBridge reports `config_invalid_value`. Top-level keys other than `$schema`, `include`, and `scanners`, and unknown keys under `include`, inside a language entry under `include.code`, and under `scanners` report `config_unknown_key`. A known key with a rejected value reports `config_invalid_value`.

Configuration defines scope only; it cannot declare a link. A project that
declares links without annotations uses the separate
[link manifest](link-manifest.md), which keeps scope changes and link changes
in different files.

`include.code` and `include.docs` are required. `include.docs` must be a non-empty array of strings.

All include globs are project-root-relative POSIX-style paths. Absolute paths, `./` prefixes, `../` traversal, and `\` separators are invalid.

`include.docs` patterns must end with `.md`.

Glob syntax supports only `*` and `**`.

- `*` matches within a single path segment and never crosses `/`.
- `**` is valid only as a full path segment.
- `?`, `[]`, `{}`, negation, and brace expansion are unsupported.

Invalid config files produce config diagnostics. If any config error exists, DocBridge does not scan project files.

<!-- @code src/config/code-language.ts#CodeIncludeEntry -->

## Code Languages

`include.code` is a language-keyed object, not an array. Each key is a fixed
lowercase code language ID, and each value is an object configuring that
language. Shorthand pattern arrays such as `"swift": ["Sources/**/*.swift"]` are
not supported; the old array form `"code": ["src/**/*.ts"]` is invalid.

Supported language IDs are `typescript`, `swift`, `dart`, `rust`, `go`,
`javascript`, `python`, `ruby`, and `java`. Any other key is an error. `include.code` must configure at least one language; an empty
object is an error.

```json
{
  "include": {
    "code": {
      "typescript": { "patterns": ["src/**/*.ts"] },
      "swift": {
        "patterns": ["Sources/**/*.swift"],
        "visibility": ["public", "open", "internal"]
      },
      "dart": { "patterns": ["lib/**/*.dart"], "visibility": ["public"] },
      "rust": { "patterns": ["src/**/*.rs"], "visibility": ["pub"] },
      "go": { "patterns": ["cmd/**/*.go", "internal/**/*.go"] },
      "javascript": { "patterns": ["web/**/*.js", "web/**/*.jsx"] },
      "python": { "patterns": ["app/**/*.py"], "visibility": ["public"] },
      "ruby": { "patterns": ["lib/**/*.rb"] },
      "java": { "patterns": ["src/main/java/**/*.java"] }
    },
    "docs": ["docs/**/*.md"]
  }
}
```

Each entry requires a non-empty `patterns` array of strings. Patterns must end
with one of the language's suffixes and with none of its excluded suffixes:

| Language ID  | Pattern suffixes              | Excluded suffixes           |
| ------------ | ----------------------------- | --------------------------- |
| `typescript` | `.ts`, `.tsx`, `.mts`, `.cts` | `.d.ts`, `.d.mts`, `.d.cts` |
| `swift`      | `.swift`                      |                             |
| `dart`       | `.dart`                       |                             |
| `rust`       | `.rs`                         |                             |
| `go`         | `.go`                         |                             |
| `javascript` | `.js`, `.jsx`, `.mjs`, `.cjs` |                             |
| `python`     | `.py`                         |                             |
| `ruby`       | `.rb`                         |                             |
| `java`       | `.java`                       |                             |

A matched file that ends with an excluded suffix is not a managed code file.
An optional `visibility` array narrows the audited public surface; allowed
values are validated per language adapter. Swift accepts `public`, `open`, and `internal`; omitting
`visibility` scans `public` and `open`. Dart accepts `public`. TypeScript
accepts `public`, `protected`, and `private`; omitting `visibility` scans
`public` and `protected`. Rust accepts `pub` and `private`; omitting
`visibility` scans `pub` only. `pub` means unrestricted `pub` visibility;
`private` means every other visibility (`pub(crate)`, `pub(super)`,
`pub(in path)`, and inherited/private). Go accepts `exported` and `unexported`;
omitting `visibility` scans `exported` only. A Go method is `exported` only
when both its name and its receiver or interface type name are exported (see
[Go Scanning](scanning.md#go-scanning)). JavaScript accepts the TypeScript
values `public`, `protected`, and `private` with the same default; every
JavaScript member classifies as `public`. Python accepts `public` and
`private`; omitting `visibility` scans `public` only, and a name is `private`
when it or an enclosing class name starts with `_` and is not a `__dunder__`
name. Ruby accepts `public`, `protected`, and `private`; omitting `visibility`
scans `public` only, and classes, modules, and constants are always `public`.
Java accepts `public`, `protected`, `package`, and `private`; omitting
`visibility` scans `public` only, interface members without an access modifier
and enum constants are `public`, and a declaration is never more visible than
an enclosing type (see [Python Scanning](scanning.md#python-scanning),
[Ruby Scanning](scanning.md#ruby-scanning), and
[Java Scanning](scanning.md#java-scanning)).

TypeScript `visibility` applies only to type members. Top-level declarations are
scoped by `export` and are unaffected by it. A member excluded by visibility is
not an endpoint, and a `@doc` on one is `unsupported_declaration`.

JavaScript is scanned in process by the TypeScript scanner. Python, Ruby, and
Java are scanned by runtime-backed workers that need the language runtime on
the machine running DocBridge; [Scanner Runtimes](#scanner-runtimes) chooses
it.

If the same code file matches the patterns of more than one configured language,
configuration is invalid (`config_invalid_value`): every code file must belong
to exactly one language.

<!-- @code src/config/scanner-runtimes.ts#ScannerRuntimes -->
<!-- @code src/scan/code/worker/runtime-worker.ts#resolveRuntimeWorkerCommand -->

## Scanner Runtimes

The optional top-level `scanners` object chooses the runtime that starts a
runtime-backed scanner worker for the configured Python, Ruby, and Java
files.

```json
{
  "scanners": {
    "python": { "command": ["py", "-3.12"] },
    "java": { "command": ["tools/jdk/bin/java"] }
  }
}
```

The only keys are `python`, `ruby`, and `java`; any other key, and any key
other than `command` inside an entry, reports `config_unknown_key`. `command`
is required and must be a non-empty array of non-empty strings; anything else
reports `config_invalid_value`.

`command` is an argv array, never a shell string: the first element is the
runtime executable and the rest are its own arguments. DocBridge appends the
worker's fixed runtime flags and bundled entrypoint, listed in
[Code Scanning](scanning.md#code-scanning). A first element that contains a
path separator and is not absolute resolves against the project root; a bare
name such as `python3.12` is looked up on `PATH`. DocBridge starts the command
without a shell, so on Windows the executable must be a program, not a batch
file.

DocBridge picks a language's runtime in this order:

1. `scanners.<language>.command`.
2. The environment variable `DOCBRIDGE_PYTHON_RUNTIME`,
   `DOCBRIDGE_RUBY_RUNTIME`, or `DOCBRIDGE_JAVA_RUNTIME`, holding one
   executable path that resolves like the first element of `command`. An
   empty value counts as unset.
3. The documented candidates: `python3`, then `python` for Python (`py -3`,
   then `python` on Windows); `ruby` for Ruby; `java` for Java.

Every runtime must pass the worker's probe before DocBridge uses it. The
configured command and the environment variable are explicit overrides: the
one that applies is the only runtime tried, and when it is missing or fails
its probe the scan reports the failure naming that override, with no fallback.
Only the documented candidates fall through to the next one.

A configured command or environment variable runs with the permissions of the
user running DocBridge, in the CLI and in the language server. Review
`scanners` in a repository you do not trust before running DocBridge there, as
you would any other command the repository asks you to run.

<!-- @code src/config/config.ts#loadConfig -->

## Loading Configuration

Configuration loading reads `docbridge.config.json` from the project root and
reports an error when the file is absent. When the parsed config is otherwise
valid, the managed code files are collected to reject any file claimed by more
than one configured language.
