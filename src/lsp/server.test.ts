import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "bun:test";

import { Project } from "./project";
import { Server, type SendFn } from "./server";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../examples/typescript");
const ROOT_URI = pathToFileURL(EXAMPLE_ROOT).href;
const CODE_URI = pathToFileURL(resolve(EXAMPLE_ROOT, "src/auth/login.ts")).href;
const DOC_URI = pathToFileURL(resolve(EXAMPLE_ROOT, "docs/auth.md")).href;

type Outgoing = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  params?: unknown;
};

function harness(options: { debounceMs?: number } = {}) {
  const sent: Outgoing[] = [];
  const send: SendFn = (message) => sent.push(message as Outgoing);
  let exitCode: number | null = null;
  const server = new Server(send, {
    debounceMs: options.debounceMs ?? 0,
    onExit: (code) => {
      exitCode = code;
    },
  });
  return { server, sent, getExit: () => exitCode };
}

function init(server: Server): void {
  server.handle({ method: "initialize", id: 1, params: { rootUri: ROOT_URI } });
  server.handle({ method: "initialized", params: {} });
}

const tick = () => new Promise((done) => setTimeout(done, 10));

describe(Server, () => {
  test("initialize returns the declared capabilities", () => {
    const { server, sent } = harness();
    server.handle({ method: "initialize", id: 1, params: { rootUri: ROOT_URI } });

    expect(sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
        },
      },
    });
  });

  test("shutdown responds null and exit reports a clean code", () => {
    const { server, sent, getExit } = harness();
    init(server);
    server.handle({ method: "shutdown", id: 2 });
    server.handle({ method: "exit" });

    expect(sent.find((m) => m.id === 2)?.result).toBeNull();
    expect(getExit()).toBe(0);
  });

  test("didOpen on a file with a link error publishes the diagnostic", () => {
    const { server, sent } = harness();
    init(server);
    server.handle({
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: CODE_URI,
          text: "/**\n * @doc docs/auth.md#missing\n */\nexport async function login() {}\n",
        },
      },
    });

    const published = sent.find((m) => m.method === "textDocument/publishDiagnostics");
    const params = published?.params as { uri: string; diagnostics: Array<{ code: string }> };
    expect(params.uri).toBe(CODE_URI);
    expect(params.diagnostics.map((d) => d.code)).toContain("doc_anchor_not_found");
  });

  test("a change that fixes the error clears it on the next publish", async () => {
    const { server, sent } = harness({ debounceMs: 0 });
    init(server);
    server.handle({
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: CODE_URI,
          text: "/**\n * @doc docs/auth.md#missing\n */\nexport async function login() {}\n",
        },
      },
    });
    server.handle({
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: CODE_URI },
        contentChanges: [
          { text: "/**\n * @doc docs/auth.md#login-spec\n */\nexport async function login() {}\n" },
        ],
      },
    });
    await tick();

    const published = sent.filter((m) => m.method === "textDocument/publishDiagnostics");
    const last = published[published.length - 1]?.params as { diagnostics: unknown[] };
    expect(last.diagnostics).toEqual([]);
  });

  test("hover over a linked symbol returns the doc section", () => {
    const { server, sent } = harness();
    init(server);
    // `login` name on line 4 (0-based 3), character 23.
    server.handle({
      method: "textDocument/hover",
      id: 5,
      params: { textDocument: { uri: CODE_URI }, position: { line: 3, character: 23 } },
    });

    const result = sent.find((m) => m.id === 5)?.result as {
      contents: { kind: string; value: string };
    } | null;
    expect(result?.contents.kind).toBe("markdown");
    expect(result?.contents.value).toContain("Login Spec");
  });

  test("definition from a heading returns the code declaration location", () => {
    const { server, sent } = harness();
    init(server);
    // `Login Spec` heading text on line 2 (0-based 1), character 5.
    server.handle({
      method: "textDocument/definition",
      id: 6,
      params: { textDocument: { uri: DOC_URI }, position: { line: 1, character: 5 } },
    });

    const result = sent.find((m) => m.id === 6)?.result as Array<{ uri: string }> | null;
    expect(result?.[0]?.uri).toBe(CODE_URI);
  });

  test("references from a heading returns the linking code symbol", () => {
    const { server, sent } = harness();
    init(server);
    server.handle({
      method: "textDocument/references",
      id: 7,
      params: {
        textDocument: { uri: DOC_URI },
        position: { line: 1, character: 5 },
        context: { includeDeclaration: false },
      },
    });

    const result = sent.find((m) => m.id === 7)?.result as Array<{ uri: string }>;
    expect(result.map((location) => location.uri)).toEqual([CODE_URI]);
  });

  test("read-only requests reuse the resolved state without re-resolving", () => {
    let resolveCount = 0;
    class CountingProject extends Project {
      resolve(): ReturnType<Project["resolve"]> {
        resolveCount += 1;
        return super.resolve();
      }
    }
    const sent: Outgoing[] = [];
    const server = new Server((message) => sent.push(message as Outgoing), {
      debounceMs: 0,
      makeProject: (root) => new CountingProject(root),
    });
    init(server);
    // The initial `initialized` flush resolves once.
    expect(resolveCount).toBe(1);

    server.handle({
      method: "textDocument/hover",
      id: 10,
      params: { textDocument: { uri: CODE_URI }, position: { line: 3, character: 23 } },
    });
    server.handle({
      method: "textDocument/definition",
      id: 11,
      params: { textDocument: { uri: DOC_URI }, position: { line: 1, character: 5 } },
    });
    // Neither read-only request changed content, so no re-resolution happens.
    expect(resolveCount).toBe(1);
  });

  test("an unknown request gets a null result", () => {
    const { server, sent } = harness();
    init(server);
    server.handle({ method: "textDocument/documentSymbol", id: 8, params: {} });

    expect(sent.find((m) => m.id === 8)?.result).toBeNull();
  });
});
