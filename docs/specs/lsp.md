# LSP

SpecLink v0.2 provides a Language Server, `speclink lsp`, that exposes the
SpecLink link graph to editors over the Language Server Protocol.

The server is additive. It reuses the v0.1 scanners and resolver and does not
change `speclink check`.

Rationale and scope decisions live in [v0.2 Decisions](../decisions/v0.2.md).

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
- `initialized` — handshake complete; the server builds the initial link graph.
- `shutdown` — prepare to exit; stop producing work.
- `exit` — terminate the process.

Declared server capabilities:

```jsonc
{
  "textDocumentSync": 1,        // Full
  "hoverProvider": true,
  "definitionProvider": true,
  "referencesProvider": true
}
```

`publishDiagnostics` is a server-to-client push and needs no capability flag.

<!-- @code src/lsp/project.ts#Project -->
## Document model

The server uses a whole-project model.

- On `initialized`, the server loads `speclink.config.json` from the resolved
  root, collects every file matched by the include globs, scans them from disk,
  and resolves the full link graph.
- Open documents overlay their on-disk content. For any open URI, the server uses
  the editor's buffer text (including unsaved edits) instead of the file on disk.
- The whole graph is rebuilt when content changes, so cross-file diagnostics and
  References stay correct.

A whole-project model is required: backlink diagnostics and "find all code that
links to this spec" cannot be derived from a single open file.

Single-root only. Multi-root workspaces are out of scope for v0.2.

### Document synchronization

Full synchronization (`TextDocumentSyncKind.Full`).

- `textDocument/didOpen` — record the URI and its full text; mark it open.
- `textDocument/didChange` — replace the stored text with the full new text.
- `textDocument/didClose` — drop the buffer overlay; the file reverts to its
  on-disk version in the graph.

After a change, the server re-resolves the project. A short debounce coalesces
rapid edits before re-resolution.

<!-- @code src/lsp/position.ts#toLspPosition -->
<!-- @code src/lsp/paths.ts#uriToRelativePath -->
### Positions and paths

- Position encoding is LSP-default UTF-16 code units. SpecLink positions are
  derived from JavaScript string indexing, which is UTF-16, so no conversion of
  units is required.
- LSP `Position.line` and `Position.character` are 0-based. SpecLink `line` and
  `column` are 1-based. The server converts at the protocol boundary.
- Document URIs are `file://` URIs. The server converts them to and from
  project-root-relative paths. Windows-specific path handling is out of scope for
  v0.2.

## Ranges

v0.1 records a single point per element. v0.2 enriches the scanners to record
ranges:

- `nameRange` — the declaration name identifier in TypeScript (for example, the
  `login` identifier).
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

<!-- @code src/core/graph.ts#LinkGraph -->
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
the linked code endpoint plus the declaration's signature line.

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

The server publishes the v0.1 diagnostics through
`textDocument/publishDiagnostics`. The computation is unchanged; the mapping to
LSP is defined in [Diagnostics](./diagnostics.md). v0.2 adds no new
diagnostic codes.

The server publishes diagnostics for open documents. Because the whole graph is
in memory, open documents receive correct cross-file diagnostics.

## CLI

```sh
speclink lsp
```

`lsp` runs the Language Server over stdio. It takes no options. The project root
is taken from the `initialize` request, not from a flag.

`speclink check` is unchanged.
