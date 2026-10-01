# LSP

DocBridge provides a Language Server, `docbridge lsp`, that exposes the
DocBridge link graph to editors over the Language Server Protocol.

The server is additive. It reuses the `check` scanners and resolver and does not
change `docbridge check`.

The original rationale and scope decisions live in the historical
[v0.2 decisions](../decisions/v0.2.md).

<!-- @code src/lsp/transport.ts#encodeMessage -->

## Transport

The server speaks LSP (JSON-RPC 2.0) over stdio. It reads requests from stdin and
writes responses to stdout. It is not a network server.

Messages use the LSP base protocol framing:

```text
Content-Length: <byte-length>\r\n
\r\n
<JSON body>
```

`Content-Length` is the byte length of the UTF-8 encoded JSON body, not its
character length. The reader handles bodies split across reads and multiple
messages arriving in one read.

<!-- @code src/lsp/server.ts#Server -->

## Lifecycle

The server implements the standard LSP lifecycle:

- `initialize` — the server declares its capabilities and resolves the project
  root from `rootUri` or `workspaceFolders`.
- `initialized` — handshake complete; the server starts building the initial
  link graph in the background.
- `shutdown` — prepare to exit; cancel the running scan and stop producing work.
- `exit` — terminate the process.

Declared server capabilities:

```jsonc
{
  "textDocumentSync": 1, // Full
  "hoverProvider": true,
  "definitionProvider": true,
  "referencesProvider": true,
}
```

`publishDiagnostics` is a server-to-client push and needs no capability flag.

<!-- @code src/lsp/project.ts#Project -->

## Document model

The server uses a whole-project model.

- On `initialized`, the server loads `docbridge.config.json` from the resolved
  root, collects every file matched by the include globs, scans them from disk,
  and resolves the full link graph.
- Open documents overlay their on-disk content. For any open URI, the server uses
  the editor's buffer text (including unsaved edits) instead of the file on disk.
- The whole graph is rebuilt when content changes, so cross-file diagnostics and
  References stay correct. Rebuilds run in the background; see
  [Rescan scheduling](#rescan-scheduling).
- `docbridge.config.json` and the optional `docbridge.links.json` link manifest
  are read from disk on every rebuild. Unsaved edits to them are not used; a
  saved change takes effect at the next rebuild.
- A rebuild reuses the code scan result of a file whose language, path,
  content, configured visibility, and resolved worker command are unchanged
  since the last accepted rebuild, and sends only the other files to their
  language's worker, one request per language as in
  [Code Scanning](scanning.md#code-scanning). A runtime-backed worker's
  runtime must be unchanged too: the runtime and version its probe reports
  and the executable its command's runtime resolves to on `PATH`. A `PATH`
  change that swaps the `python3` behind the same command therefore rescans
  every file of that language. A parse error is reused; a scanner failure is
  retried at the next rebuild. A configuration change discards every reused
  result and every cached runtime probe. Markdown, the link manifest, and the
  graph are rebuilt in full each time.

A whole-project model is required: backlink diagnostics and "find all code that
links to this spec" cannot be derived from a single open file.

Single-root only. Multi-root workspaces are not supported.

<!-- @code src/lsp/project.ts#Project.setOverlay -->
<!-- @code src/lsp/project.ts#Project.clearOverlay -->

### Document synchronization

Full synchronization (`TextDocumentSyncKind.Full`).

- `textDocument/didOpen` — record the URI and its full text; mark it open.
- `textDocument/didChange` — replace the stored text with the full new text.
- `textDocument/didClose` — drop the buffer overlay; the file reverts to its
  on-disk version in the graph.

Each of these notifications makes the running scan stale and requests a new
one. `didOpen` and `didClose` request it at once. `didChange` requests it after
a 50 ms debounce that each further change restarts, so rapid edits coalesce
into one rescan.

<!-- @code src/lsp/scheduler.ts#RescanScheduler -->

### Rescan scheduling

Scans run in the background; the server keeps reading and answering messages
while one runs.

- At most one scan runs at a time. A request cancels the running scan at once,
  which kills its worker process.
- Requests that arrive while a scan runs leave exactly one follow-up scan. It
  starts once the running scan has settled and any debounce has elapsed.
- A scan takes its configuration, manifest, open-buffer text, and file content
  when it starts. Its result is accepted only if no request arrived after it
  started; otherwise it is discarded, and neither its diagnostics nor its
  reusable code scan results are kept.
- After each accepted scan, the server publishes diagnostics for every open
  document.
- Hover, Definition, and References never wait for a scan. They answer from the
  last accepted scan, even while a newer one runs. Before the first scan is
  accepted, they answer as for an empty project: `null` for Hover and
  Definition, an empty list for References.
- After `shutdown`, the server cancels the running scan, starts no other,
  ignores document notifications, and publishes nothing more.
- A scan that fails for any reason other than cancellation is reported on
  stderr and publishes nothing; the next request scans again.

<!-- @code src/lsp/position.ts#toLspPosition -->
<!-- @code src/lsp/paths.ts#uriToRelativePath -->

### Positions and paths

- Position encoding is LSP-default UTF-16 code units. DocBridge positions are
  derived from JavaScript string indexing, which is UTF-16, so no conversion of
  units is required.
- LSP `Position.line` and `Position.character` are 0-based. DocBridge `line` and
  `column` are 1-based. The server converts at the protocol boundary.
- Document URIs are `file://` URIs. The server converts them to and from
  project-root-relative paths. Windows-specific path handling is not
  supported.

## Ranges

Diagnostics record a single point per element. For the server, the scanners
also record ranges:

- `nameRange` — the declaration name identifier in code (for example, the
  `login` identifier in TypeScript, Swift, Dart, Rust, or Go).
- `headingTextRange` — the heading text in Markdown, excluding leading `#` and
  surrounding whitespace.
- `targetRange` — the target string of an annotation (the `file#fragment` text in
  `@doc` / `@code`).

Navigation uses `nameRange` and `headingTextRange`. Diagnostics use `targetRange`
or the element range. When a range cannot be derived, the whole line is used as a
fallback.

<!-- @code src/lsp/index-lookup.ts#PositionIndex -->

## Hit testing

A position hits an element when it falls within that element's range:

- A position within a code symbol's `nameRange` resolves to that code endpoint.
- A position within a heading's `headingTextRange` resolves to that doc endpoint.

Positions on whitespace, parameters, or other parts of a declaration line do not
trigger navigation.

<!-- @code src/link/graph.ts#LinkGraph -->
<!-- @code src/link/graph.ts#buildLinkGraph -->

## Navigation and resolvable one-way links

Navigation follows any declared annotation whose target resolves to an existing
file and anchor, whether or not the reverse backlink exists. Backlink
completeness is reported by diagnostics, not by suppressing navigation.

A target that does not resolve (missing file or missing anchor) is never
navigable.

<!-- @code src/lsp/hover.ts#hover -->

## Hover

`textDocument/hover` returns Markdown content.

### Code to doc

When the position hits a code symbol that links to a doc anchor, the server
returns the linked Markdown **section** inline:

- The section starts at the target heading and ends just before the next heading
  at the same or a higher level. Deeper subsections are included.
- Fenced code blocks are not treated as headings, so `#` inside a fence does not
  end the section.
- One-to-many: linked sections are concatenated, separated by a divider.
- A loose length cap truncates very long sections with a continuation marker.

### Doc to code

When the position hits a heading that links to a code symbol, the server returns
the linked code endpoint plus the declaration's signature, fenced in the
declaration's language. The signature is the scanner's signature range without
the leading doc comment. It can span several lines and keeps attributes and
decorators. When the scanner reports no signature range, only the endpoint is
shown.

<!-- @code src/lsp/navigation.ts#definition -->

## Definition

`textDocument/definition` returns the linked counterpart location(s).

- From a code symbol: the target doc heading location(s).
- From a heading: the linked code declaration location(s).
- One-to-many returns multiple `Location`s; the editor presents a picker.

The target `Location.range` uses the counterpart's `headingTextRange` or
`nameRange`.

<!-- @code src/lsp/navigation.ts#references -->

## References

`textDocument/references` returns every counterpart linked to the element, using
the symmetric counterpart model.

- From a heading: all code symbols that link to it. This answers "find all code
  that implements this spec."
- From a code symbol: all doc sections it links to.

Each reference is a `Location` at the counterpart's element range.

## Diagnostics

The server publishes the same diagnostics as `docbridge check` through
`textDocument/publishDiagnostics`. The computation is shared; the mapping to
LSP is defined in [Diagnostics](./diagnostics.md). The server adds no
diagnostic codes of its own.

The server publishes diagnostics for open documents after each accepted scan.
Because the whole graph is in memory, open documents receive correct cross-file
diagnostics.

<!-- @code src/lsp/server.ts#runLspServer -->

## CLI

```sh
docbridge lsp
```

`lsp` runs the Language Server over stdio. It takes no options. The project root
is taken from the `initialize` request, not from a flag.

`docbridge check` is unchanged.

## VS Code-Compatible Client

The VS Code-compatible extension is a thin LSP client. It starts the bundled
`docbridge lsp` server through Bun and attaches to these VS Code language IDs:

- `typescript`
- `typescriptreact`
- `swift`
- `dart`
- `rust`
- `go`
- `markdown`

The extension does not duplicate DocBridge include-pattern filtering. It only
selects candidate document languages; the server decides which files are managed
from `docbridge.config.json`.
