import { existsSync } from "node:fs";
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

function defaultCliPath(context: ExtensionContext): string {
  const bundledDistCli = context.asAbsolutePath(path.join("server", "dist", "index.js"));
  if (existsSync(bundledDistCli)) {
    return bundledDistCli;
  }

  const bundledCli = context.asAbsolutePath(path.join("server", "src", "cli", "index.ts"));
  if (existsSync(bundledCli)) {
    return bundledCli;
  }

  return context.asAbsolutePath(path.join("..", "..", "src", "cli", "index.ts"));
}

/**
 * Activate the DocBridge client: launch `docbridge lsp` over stdio and bind it to
 * supported code and Markdown documents. The server is run through Bun from the
 * bundled CLI; configure `docbridge.bunPath` if `bun` is not on `PATH`.
 */
export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("DocBridge");
  context.subscriptions.push(output);

  const configuredBun = workspace.getConfiguration("docbridge").get<string>("bunPath");
  const bun = nonEmpty(configuredBun) ?? process.env.DOCBRIDGE_BUN_PATH ?? "bun";
  const configuredCli = workspace.getConfiguration("docbridge").get<string>("cliPath");
  const configuredCliPath = nonEmpty(configuredCli);
  const cli = configuredCliPath ?? defaultCliPath(context);
  if (configuredCliPath !== undefined && !path.isAbsolute(configuredCliPath)) {
    const message = "docbridge.cliPath must be an absolute path.";
    output.appendLine(message);
    void window.showErrorMessage(message);
    return;
  }
  output.appendLine(`Starting DocBridge language server: ${bun} ${cli} lsp`);

  const executable: Executable = {
    command: bun,
    args: [cli, "lsp"],
  };
  const serverOptions: ServerOptions = { run: executable, debug: executable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "swift" },
      { scheme: "file", language: "dart" },
      { scheme: "file", language: "markdown" },
    ],
    outputChannel: output,
    traceOutputChannel: output,
  };

  client = new LanguageClient("docbridge", "DocBridge", serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed to start DocBridge language server: ${message}`);
    void window.showErrorMessage(`Failed to start DocBridge language server: ${message}`);
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
