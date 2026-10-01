import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { encodeMessage, MessageReader } from "./transport";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const EXAMPLE_ROOT = resolve(REPO_ROOT, "examples/typescript");
const ROOT_URI = pathToFileURL(EXAMPLE_ROOT).href;
const CODE_PATH = resolve(EXAMPLE_ROOT, "src/auth/login.ts");
const CODE_URI = pathToFileURL(CODE_PATH).href;

type RpcMessage = { id?: number; method?: string; result?: unknown; params?: unknown };

/** Decodes the server's framed stdout and waits for messages under a watchdog. */
function messagesFrom(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new MessageReader();
  const received: RpcMessage[] = [];

  const readUntil = async (matches: (message: RpcMessage) => boolean): Promise<RpcMessage> => {
    for (;;) {
      const found = received.find(matches);
      if (found !== undefined) {
        return found;
      }
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("the server closed stdout");
      }
      decoder.append(value);
      received.push(...(decoder.read() as RpcMessage[]));
    }
  };

  return {
    /** The first message matching `matches`; rejects when none arrives within `timeoutMs`. */
    async waitFor(matches: (message: RpcMessage) => boolean, timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`no matching message within ${timeoutMs} ms`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([readUntil(matches), watchdog]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

describe("docbridge lsp conformance", () => {
  test("drives initialize -> didOpen -> diagnostics -> hover -> shutdown as a child process", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "lsp"], {
      cwd: REPO_ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const messages = messagesFrom(proc.stdout);
    const writer = proc.stdin;

    try {
      writer.write(
        encodeMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { rootUri: ROOT_URI },
        }),
      );
      writer.write(encodeMessage({ jsonrpc: "2.0", method: "initialized", params: {} }));
      writer.write(
        encodeMessage({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: { textDocument: { uri: CODE_URI, text: readFileSync(CODE_PATH, "utf8") } },
        }),
      );
      await writer.flush();

      const initialize = await messages.waitFor((m) => m.id === 1, 10_000);
      const capabilities = (initialize.result as { capabilities?: { hoverProvider?: boolean } })
        .capabilities;
      expect(capabilities?.hoverProvider).toBe(true);

      // Scans run in the background; the opened document's diagnostics mark the
      // first completed scan, after which hover answers from it.
      const published = await messages.waitFor(
        (m) =>
          m.method === "textDocument/publishDiagnostics" &&
          (m.params as { uri?: string }).uri === CODE_URI,
        10_000,
      );
      expect((published.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);

      writer.write(
        encodeMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/hover",
          // `login` name on line 4 (0-based 3), character 23.
          params: { textDocument: { uri: CODE_URI }, position: { line: 3, character: 23 } },
        }),
      );
      await writer.flush();
      const hover = await messages.waitFor((m) => m.id === 2, 10_000);
      expect((hover.result as { contents?: { value?: string } }).contents?.value).toContain(
        "Login Spec",
      );

      writer.write(encodeMessage({ jsonrpc: "2.0", id: 3, method: "shutdown" }));
      writer.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
      await writer.flush();
      writer.end();
      expect(await proc.exited).toBe(0);
    } finally {
      proc.kill();
    }
  }, 20_000);
});
