import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "bun:test";

import { encodeMessage, MessageReader } from "../../src/lsp/transport";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const EXAMPLE_ROOT = resolve(REPO_ROOT, "examples/basic");
const ROOT_URI = pathToFileURL(EXAMPLE_ROOT).href;
const CODE_URI = pathToFileURL(resolve(EXAMPLE_ROOT, "src/auth/login.ts")).href;

type RpcMessage = { id?: number; method?: string; result?: unknown };

async function collect(
  stream: ReadableStream<Uint8Array>,
  count: number,
  timeoutMs: number,
): Promise<RpcMessage[]> {
  const reader = stream.getReader();
  const decoder = new MessageReader();
  const messages: RpcMessage[] = [];
  const deadline = Date.now() + timeoutMs;

  try {
    while (messages.length < count && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        decoder.append(value);
        for (const message of decoder.read()) {
          messages.push(message as RpcMessage);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return messages;
}

describe("speclink lsp conformance", () => {
  test(
    "drives initialize -> hover -> shutdown as a child process",
    async () => {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "lsp"], {
        cwd: REPO_ROOT,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });

      const writer = proc.stdin;
      writer.write(
        encodeMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: ROOT_URI } }),
      );
      writer.write(encodeMessage({ jsonrpc: "2.0", method: "initialized", params: {} }));
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

      const messages = await collect(proc.stdout, 2, 10_000);

      const initialize = messages.find((m) => m.id === 1)?.result as
        | { capabilities?: { hoverProvider?: boolean } }
        | undefined;
      expect(initialize?.capabilities?.hoverProvider).toBe(true);

      const hover = messages.find((m) => m.id === 2)?.result as
        | { contents?: { value?: string } }
        | undefined;
      expect(hover?.contents?.value).toContain("Login Spec");

      writer.write(encodeMessage({ jsonrpc: "2.0", id: 3, method: "shutdown" }));
      writer.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
      await writer.flush();
      writer.end();
      await proc.exited;
    },
    15_000,
  );
});
