# SpecLink VS Code client

A minimal VS Code extension that launches the SpecLink language server
(`speclink lsp`) and binds it to TypeScript and Markdown documents. Its only
purpose is to verify the server in a real editor; full editor integration
(packaging, Marketplace) is deferred to v0.4.

This package carries the only `vscode-languageclient` dependency in the
repository. The server and `src/core/` do not depend on it.

## Run it (Extension Development Host)

1. Install dependencies in this directory:

   ```sh
   cd editors/vscode
   npm install
   ```

2. Open `editors/vscode` in VS Code and press `F5`. This compiles the extension
   (`npm run compile`) and launches an Extension Development Host.

3. In the development host, open a project that uses SpecLink (for example the
   repository root, which contains `examples/basic`). The extension runs
   `speclink lsp` through Bun. If `bun` is not on your `PATH`, set the
   `speclink.bunPath` setting to its absolute path.

4. Exercise the four features against a linked TypeScript/Markdown pair:
   - **Diagnostics** appear on link problems.
   - **Hover** over a linked symbol shows the spec section; hover over a heading
     shows the declaration signature.
   - **Go to Definition** jumps between code and docs.
   - **Find All References** lists all linked counterparts.

The server is launched from this repository's CLI at `../../src/cli/index.ts`.
