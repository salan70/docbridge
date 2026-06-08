# SpecLink VS Code client

A minimal VS Code extension that launches the SpecLink language server
(`speclink lsp`) and binds it to TypeScript and Markdown documents. Its only
purpose is to verify the server in a real editor; full editor integration
(packaging, Marketplace) is deferred to v0.4.

This package carries the only `vscode-languageclient` dependency in the
repository. The server and `src/core/` do not depend on it.

## Run it in Cursor or VS Code

Cursor can run this client because it is a VS Code-compatible extension.

1. From the repository root, run:

   ```sh
   just cursor-lsp
   ```

   This installs editor client dependencies, compiles the extension, packages a
   local VSIX with the SpecLink language server bundled inside, installs it into
   Cursor, and opens the repository. It also writes the local workspace setting
   `speclink.bunPath` to the current Bun executable so Cursor can start the
   language server even when the GUI environment has a different `PATH`.

   For VS Code, run:

   ```sh
   just vscode-lsp
   ```

2. In Cursor or VS Code, open a project that uses SpecLink (for example the
   repository root, which contains `examples/basic`). The extension runs
   `speclink lsp` through Bun. If `bun` is not on your `PATH`, set the
   `speclink.bunPath` setting to its absolute path.

3. Exercise the four features against a linked TypeScript/Markdown pair:
   - **Diagnostics** appear on link problems.
   - **Hover** over a linked symbol shows the spec section; hover over a heading
     shows the declaration signature.
   - **Go to Definition** jumps between code and docs.
   - **Find All References** lists all linked counterparts.

The server is launched from the CLI source bundled into the local VSIX. For
development overrides, set `speclink.cliPath` to an absolute CLI entrypoint.

If nothing happens, open **Output: SpecLink**. It should show the Bun command
used to start `speclink lsp`, or the startup error if the server could not be
launched. Diagnostics are published for open TypeScript, TSX, and Markdown files
that are part of the workspace's `speclink.config.json` include patterns.

## Verify outside an editor

Run the editor-independent LSP smoke test from the repository root:

```sh
just verify-lsp
```

This drives `speclink lsp` over stdio and checks Hover, Definition, References,
and Diagnostics.
