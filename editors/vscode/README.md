# DocBridge VS Code-Compatible Extension

This package builds the VS Code-compatible DocBridge extension under the public
extension ID `salan70.docbridge`. It launches the bundled DocBridge language
server (`docbridge lsp`) and binds it to TypeScript, TSX, Swift, Dart, and
Markdown documents.

The package carries the only `vscode-languageclient` dependency in the
repository. The server and `src/core/` do not depend on it.

## Install

Install [DocBridge](https://marketplace.visualstudio.com/items?itemName=salan70.docbridge)
(`salan70.docbridge`) from VS Code Marketplace in VS Code or Cursor. Open VSX
delivery is out of scope.

To install a locally built VSIX instead, use **Extensions: Install from
VSIX...** or a compatible editor CLI:

```sh
just package-vsix
just verify-vsix
code --install-extension editors/vscode/.tmp/out/docbridge-<version>.vsix
cursor --install-extension editors/vscode/.tmp/out/docbridge-<version>.vsix
```

The VSIX is written to:

```text
editors/vscode/.tmp/out/docbridge-<version>.vsix
```

`just package-vsix-local` builds the same artifact for the current machine only
and writes it to `docbridge-<version>-local.vsix`. See
[Development](#development) for its scanner prerequisites.

## Requirements

- Bun must be installed on the machine running the editor.
- By default, the extension starts Bun as `bun`. If the GUI editor cannot find
  Bun on `PATH`, set `docbridge.bunPath` to the absolute Bun executable path.
- The bundled DocBridge server includes scanner binaries for the supported
  package platforms that are staged before packaging. The initial universal
  VSIX expects `darwin-arm64` and `linux-x64` scanner binaries.

TypeScript, TSX, and Markdown support require only Bun. Swift, Dart, and Rust editor
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
For the core linking workflow and the rest of the documentation, use the
[documentation hub](../../docs/README.md).

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

Registry publication is currently manual. CI/CD publishing can be added after
the registry flow is proven.

Before packaging, place the extension icon at:

```text
editors/vscode/assets/icon.png
```

Also stage the supported scanner binaries under the root package layout:

```text
dist/bin/darwin-arm64/docbridge-swift-scanner
dist/bin/darwin-arm64/docbridge_dart_scanner
dist/bin/darwin-arm64/docbridge-rust-scanner
dist/bin/linux-x64/docbridge-swift-scanner
dist/bin/linux-x64/docbridge_dart_scanner
dist/bin/linux-x64/docbridge-rust-scanner
```

`just package-vsix` preserves this pre-staged `dist/bin` directory while
rebuilding `dist/index.js`, so stage scanner binaries after any standalone
`just build` run.

Build and verify the VSIX:

```sh
just package-vsix
just verify-vsix
```

`just package-vsix` bundles `vscode-languageclient` into `out/extension.js`.
vsce packs with `--no-dependencies`, so an unbundled `require()` of that module
would fail at activation.

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

Type-check the editor client:

```sh
just typecheck-extension
```

It is a separate TypeScript project that the root `tsconfig.json` does not
include, so `just typecheck` never sees it. `just verify` and the required CI
gate both run it. It needs the client's own dependencies, installed by
`just setup` or `just install-editor-deps`.

### Local install

For local VS Code verification from a source checkout:

```sh
just vscode-lsp
```

For local Cursor verification:

```sh
just cursor-lsp
```

These commands write the local workspace setting `docbridge.bunPath` to the
current Bun executable — so GUI editors can start the language server even when
their environment has a different `PATH` — then assemble, verify, and install a
local VSIX, and open the repository.

Local and release VSIX files are built by the same implementation
(`scripts/vscode-extension.ts`). They differ in one respect: a release artifact
must carry scanner binaries for every supported platform, while a local
artifact only has to run on the machine that built it. Stage the host
platform's binaries before installing:

```sh
just build-swift-scanner
just build-dart-scanner
just build-rust-scanner
just stage-scanner-binaries   # host platform only
just vscode-lsp
```

Packaging fails with the missing path and this instruction when they are
absent. Release validation is unchanged: `just package-vsix` still requires
every supported platform.

To develop against the checkout without reinstalling, run the extension with
`--extensionDevelopmentPath` (see `.vscode/launch.json`), or point
`docbridge.cliPath` at an absolute CLI entrypoint.
