# DocBridge VS Code-Compatible Extension

This package builds the VS Code-compatible DocBridge extension under the public
extension ID `salan70.docbridge`. It launches the bundled DocBridge language
server (`docbridge lsp`) and binds it to TypeScript, TSX, Swift, Dart, and
Markdown documents.

The package carries the only `vscode-languageclient` dependency in the
repository. The server and `src/core/` do not depend on it.

## Install

Once the extension is published, install `salan70.docbridge` from VS Code
Marketplace. Open VSX delivery is out of scope.

Until the first registry publish is complete, build and install the VSIX
manually:

```sh
just package-vsix
just verify-vsix
```

The VSIX is written to:

```text
editors/vscode/.tmp/out/docbridge-<version>.vsix
```

Install that file through **Extensions: Install from VSIX...** in VS Code or
with a compatible editor CLI:

```sh
code --install-extension editors/vscode/.tmp/out/docbridge-<version>.vsix
cursor --install-extension editors/vscode/.tmp/out/docbridge-<version>.vsix
```

## Requirements

- Bun must be installed on the machine running the editor.
- By default, the extension starts Bun as `bun`. If the GUI editor cannot find
  Bun on `PATH`, set `docbridge.bunPath` to the absolute Bun executable path.
- The bundled DocBridge server includes scanner binaries for the supported
  package platforms that are staged before packaging. The initial universal
  VSIX expects `darwin-arm64` and `linux-x64` scanner binaries.

TypeScript, TSX, and Markdown support require only Bun. Swift and Dart editor
support uses the bundled scanner binary for the user's platform.

## Features

For projects with `docbridge.config.json`, the extension provides:

- Diagnostics for DocBridge link problems.
- Hover from linked code symbols to Markdown sections and from headings to code
  signatures.
- Go to Definition between linked code and docs.
- Find All References across linked counterparts.

The language server behavior is specified in
[../../docs/specs/lsp.md](../../docs/specs/lsp.md).

## Configuration

`docbridge.bunPath`

: Path to the Bun executable used to launch the DocBridge language server.
Defaults to `bun`.

`docbridge.cliPath`

: Optional absolute path to a DocBridge CLI entrypoint. Defaults to the server
bundled with this extension. This is intended for source-checkout development
and must be absolute.

If startup fails, open **Output: DocBridge**. It shows the Bun command used to
start `docbridge lsp`, or the startup error.

## Manual Publishing

The first extension publication is intentionally manual. CI/CD publishing can be
added after the registry flow is proven.

Before packaging, place the extension icon at:

```text
editors/vscode/assets/icon.png
```

Also stage the supported scanner binaries under the root package layout:

```text
dist/bin/darwin-arm64/speclink-swift-scanner
dist/bin/darwin-arm64/speclink_dart_scanner
dist/bin/linux-x64/speclink-swift-scanner
dist/bin/linux-x64/speclink_dart_scanner
```

`just package-vsix` preserves this pre-staged `dist/bin` directory while
rebuilding `dist/index.js`, so stage scanner binaries after any standalone
`just build` run.

Build and verify the VSIX:

```sh
just package-vsix
just verify-vsix
```

Publish the verified artifact to VS Code Marketplace:

```sh
VSCE_PAT=<token> just publish-vscode-extension
```

The publish command accepts an explicit VSIX path:

```sh
VSCE_PAT=<token> just publish-vscode-extension path/to/docbridge.vsix
```

Attach the generated VSIX to the GitHub Release manually for the initial
delivery. Automated release attachment and registry publishing are follow-up
work.

## Development

Run the local editor-independent LSP smoke test from the repository root:

```sh
just verify-lsp
```

This drives `docbridge lsp` over stdio and checks Hover, Definition, References,
and Diagnostics.

For local VS Code verification from a source checkout:

```sh
just vscode-lsp
```

For local Cursor verification:

```sh
just cursor-lsp
```

These commands install editor client dependencies, compile the extension,
package a local development VSIX, install it into the chosen editor, and open
the repository. They also write the local workspace setting `docbridge.bunPath`
to the current Bun executable so GUI editors can start the language server even
when their environment has a different `PATH`.
