// Minimal LSP client over stdio, shared by the editor-independent smoke test
// (`scripts/lsp-verify.ts`) and the packaged-VSIX verification
// (`scripts/vscode-extension.ts`). Both drive `docbridge lsp`; only the command
// and the project root differ.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";

type Diagnostic = Record<string, unknown>;

export type LspSession = {
  /** Complete the `initialize`/`initialized` handshake against a project root. */
  initialize(projectRoot: string): Promise<void>;
  /** Server capabilities from the `initialize` response. */
  capabilities(): Record<string, unknown>;
  request<T>(method: string, params: unknown): Promise<T>;
  notify(method: string, params: unknown): void;
  openDocument(uri: string, languageId: string, text: string): void;
  /** Diagnostics published so far for a document, without waiting. */
  diagnosticsFor(uri: string): Diagnostic[];
  /**
   * Diagnostics for a document once the server has published them. Polling
   * beats a fixed sleep: a fast server returns immediately and a slow one is
   * not a flake.
   */
  waitForDiagnostics(uri: string, timeoutMs?: number): Promise<Diagnostic[]>;
  stop(): Promise<void>;
};

export function documentUri(path: string): string {
  return pathToFileURL(path).href;
}

export function startLspSession(command: string[], cwd: string): LspSession {
  const [executable, ...args] = command;
  if (executable === undefined) {
    throw new Error("startLspSession requires a command to run.");
  }

  const child = spawn(executable, args, { cwd });
  const pending = new Map<number, (result: unknown) => void>();
  const diagnostics = new Map<string, Diagnostic[]>();
  const decodeMessages = createMessageDecoder();
  let capabilities: Record<string, unknown> = {};
  let nextId = 1;

  child.stdout.on("data", (chunk: Buffer) => {
    for (const message of decodeMessages(chunk)) {
      const id = typeof message.id === "number" ? message.id : undefined;
      const settle = id === undefined ? undefined : pending.get(id);
      if (settle !== undefined && id !== undefined) {
        settle(message.result);
        pending.delete(id);
      } else if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as { uri: string; diagnostics: Diagnostic[] };
        diagnostics.set(params.uri, params.diagnostics);
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  function send(message: Record<string, unknown>): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  function request<T>(method: string, params: unknown): Promise<T> {
    const id = nextId++;
    return new Promise<T>((settle) => {
      pending.set(id, (result) => settle(result as T));
      send({ id, method, params });
    });
  }

  return {
    async initialize(projectRoot: string): Promise<void> {
      const result = await request<{ capabilities?: Record<string, unknown> }>("initialize", {
        rootUri: documentUri(projectRoot),
      });
      capabilities = result?.capabilities ?? {};
      send({ method: "initialized", params: {} });
    },
    capabilities(): Record<string, unknown> {
      return capabilities;
    },
    request,
    notify(method: string, params: unknown): void {
      send({ method, params });
    },
    openDocument(uri: string, languageId: string, text: string): void {
      send({
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId, version: 1, text } },
      });
    },
    diagnosticsFor(uri: string): Diagnostic[] {
      return diagnostics.get(uri) ?? [];
    },
    async waitForDiagnostics(uri: string, timeoutMs = 5000): Promise<Diagnostic[]> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const published = diagnostics.get(uri);
        if (published !== undefined && published.length > 0) {
          return published;
        }
        if (Date.now() >= deadline) {
          return published ?? [];
        }
        await sleep(25);
      }
    },
    async stop(): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      await request<null>("shutdown", null);
      send({ method: "exit", params: {} });
      await waitForExit(child);
    },
  };
}

/**
 * Stateful `Content-Length` framing decoder. A single `data` chunk can carry a
 * partial header, several whole messages, or both, so the leftover bytes have
 * to survive between calls.
 */
function createMessageDecoder(): (chunk: Buffer) => Record<string, unknown>[] {
  let buffered = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const messages: Record<string, unknown>[] = [];

    for (;;) {
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return messages;
      }
      const header = buffered.subarray(0, headerEnd).toString("utf8");
      const length = Number(/Content-Length: (\d+)/.exec(header)?.[1]);
      if (Number.isNaN(length)) {
        throw new Error(`Language server sent a frame without Content-Length: ${header}`);
      }
      const start = headerEnd + 4;
      if (buffered.length < start + length) {
        return messages;
      }
      messages.push(
        JSON.parse(buffered.subarray(start, start + length).toString("utf8")) as Record<
          string,
          unknown
        >,
      );
      buffered = buffered.subarray(start + length);
    }
  };
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>((settle) => {
    child.once("exit", () => settle());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((settle) => {
    setTimeout(settle, ms);
  });
}
