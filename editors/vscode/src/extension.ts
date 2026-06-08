import * as path from "node:path";

import { window, workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  type Executable,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Activate the SpecLink client: launch `speclink lsp` over stdio and bind it to
 * TypeScript and Markdown documents. The server is run through Bun from this
 * repository's CLI; configure `speclink.bunPath` if `bun` is not on `PATH`.
 */
export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("SpecLink");
  context.subscriptions.push(output);

  const configuredBun = workspace.getConfiguration("speclink").get<string>("bunPath");
  const bun = nonEmpty(configuredBun) ?? process.env.SPECLINK_BUN_PATH ?? "bun";
  const configuredCli = workspace.getConfiguration("speclink").get<string>("cliPath");
  const cli =
    nonEmpty(configuredCli) ?? context.asAbsolutePath(path.join("server", "src", "cli", "index.ts"));
  output.appendLine(`Starting SpecLink language server: ${bun} run ${cli} lsp`);

  const executable: Executable = {
    command: bun,
    args: ["run", cli, "lsp"],
  };
  const serverOptions: ServerOptions = { run: executable, debug: executable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "markdown" },
    ],
    outputChannel: output,
    traceOutputChannel: output,
  };

  client = new LanguageClient("speclink", "SpecLink", serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed to start SpecLink language server: ${message}`);
    void window.showErrorMessage(`Failed to start SpecLink language server: ${message}`);
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
