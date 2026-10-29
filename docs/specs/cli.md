# CLI

The DocBridge CLI is the native executable built from `crates/docbridge`. Its public contracts are fixed in [vNext public contracts](vnext-contracts.md); this document describes the command surface and the output model.

<!-- @code crates/docbridge/src/cli.rs -->
<!-- @code crates/docbridge/src/main.rs -->

## Commands

```sh
docbridge validate [--root <directory>] [--json]
docbridge links [--root <directory>] [--json] [--stdin] [--include-content] [selectors...]
docbridge unlinked [--root <directory>] [--json]
docbridge init [--root <directory>] [--dry-run] [--yes] [--force] [--claude]
docbridge deinit [--dry-run]
docbridge docs [list | show <name>]
docbridge upgrade [--check] [--dry-run] [--yes]
```

- `validate` checks configuration and Markdown link annotations. `--json` prints `diagnostics` and a `summary` with `files`, `links`, `errors`, and `complete`.
- `links` retrieves direct edges for file or section selectors (`relative/document.md#parent/child`), from arguments or stdin. A valid glob that matches nothing succeeds with an empty graph. `--include-content` adds the requested text.
- `unlinked` lists code files and Markdown regions that no annotation covers.
- `init`, `deinit`, `docs`, and `upgrade` manage project assets, embedded guides, and verified updates. Exit codes are listed in the contracts document.
- Commands that need configuration read `docbridge.config.json` from `--root` or the current directory only; they do not search upward.
- Commands are registered in one place, `crates/docbridge/src/cli.rs` (the `Command` enum and the `HELP` text). `lifecycle` (`init`, `deinit`) and `upgrade` are dispatched to their own modules. A new command must be added to the enum, the parser, `HELP`, and the embedded guides.
- The legacy `check`, `related`, `context`, `graph`, `init-with-agent`, and `lsp` commands, and the `--gate` and `--audit` flags, were removed at the cutover (#215) without aliases. They are rejected as unknown arguments. The migration guide (`docbridge docs show migration`) maps them to the current commands.

<!-- @code crates/docbridge/src/output.rs -->
<!-- @code crates/docbridge/src/query.rs -->

## Output model

When invoked with `--json`, query commands (`links`, `unlinked`) print one JSON object with this shape; without `--json` they print text:

```ts
type Graph = {
  nodes: Node[];
  edges: { source: string; target: string }[];
  diagnostics: { code: string; path: string; line?: number; message: string }[];
  complete: boolean;
  contents?: { id: string; path: string; start_line: number; end_line: number; text: string }[];
};
type Node = {
  id: string; // root-relative path, or path#parent/child for a section
  kind: "code" | "section";
  path: string;
  title?: string;
  level?: number;
  parents: string[];
  line: number;
  end_line: number;
  content?: { block: string; start_line: number; end_line: number };
  children?: Node[];
  regions?: { start_line: number; end_line: number }[]; // unlinked Markdown regions
};
```

IDs and ordering are deterministic and root-relative. `complete` is false when any diagnostic exists or when a managed file could not be read, so a clean-looking result is never reported for an incomplete scan. Diagnostic codes are listed in [Diagnostics](diagnostics.md#diagnostics).
