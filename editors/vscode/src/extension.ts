import * as path from "node:path";

import { workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type Executable,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/**
 * Activate the SpecLink client: launch `speclink lsp` over stdio and bind it to
 * TypeScript and Markdown documents. The server is run through Bun from this
 * repository's CLI; configure `speclink.bunPath` if `bun` is not on `PATH`.
 */
export function activate(context: ExtensionContext): void {
  const bun = workspace.getConfiguration("speclink").get<string>("bunPath") ?? "bun";
  // The extension lives at <repo>/editors/vscode, so the CLI is two levels up.
  const cli = context.asAbsolutePath(path.join("..", "..", "src", "cli", "index.ts"));

  const executable: Executable = {
    command: bun,
    args: ["run", cli, "lsp"],
    transport: TransportKind.stdio,
  };
  const serverOptions: ServerOptions = { run: executable, debug: executable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "markdown" },
    ],
  };

  client = new LanguageClient("speclink", "SpecLink", serverOptions, clientOptions);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
