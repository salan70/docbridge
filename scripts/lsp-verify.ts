// Editor-independent verification of the SpecLink language server.
// Drives `speclink lsp` over stdio and checks hover, definition, references,
// and diagnostics against the repo's own dogfooded links. Run with:
//   bun run scripts/lsp-verify.ts
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const child = spawn("bun", ["run", "src/cli/index.ts", "lsp"], { cwd: root });

const pending = new Map<number, (result: unknown) => void>();
const diagnostics = new Map<string, unknown[]>();
let nextId = 1;

function send(msg: Record<string, unknown>) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...msg });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((res) => {
    pending.set(id, res);
    send({ id, method, params });
  });
}

let buf = Buffer.alloc(0);
child.stdout.on("data", (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const len = Number(/Content-Length: (\d+)/.exec(buf.subarray(0, headerEnd).toString())?.[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const msg = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
    buf = buf.subarray(start + len);
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    } else if (msg.method === "textDocument/publishDiagnostics") {
      diagnostics.set(msg.params.uri, msg.params.diagnostics);
    }
  }
});
child.stderr.on("data", (c: Buffer) => process.stderr.write(c));

const uri = (rel: string) => `file://${resolve(root, rel)}`;
const open = (rel: string, text: string) =>
  send({
    method: "textDocument/didOpen",
    params: { textDocument: { uri: uri(rel), languageId: rel.endsWith(".ts") ? "typescript" : "markdown", version: 1, text } },
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

const serverTs = readFileSync(resolve(root, "src/lsp/server.ts"), "utf8");
const lines = serverTs.split("\n");
const line = lines.findIndex((l) => l.includes("export class Server"));
const character = lines[line].indexOf("Server") + 2;
const pos = { line, character };

await request("initialize", { rootUri: `file://${root}` });
send({ method: "initialized", params: {} });
open("src/lsp/server.ts", serverTs);
await sleep(300);

// 1. Hover on the `Server` class → spec section from lsp.md.
const hover = await request("textDocument/hover", { textDocument: { uri: uri("src/lsp/server.ts") }, position: pos });
check("hover", typeof hover?.contents?.value === "string" && hover.contents.value.includes("Lifecycle"),
  hover ? `returned ${hover.contents.value.length} chars` : "null");

// 2. Definition on the same symbol → jumps into docs/specs/lsp.md.
const def = await request("textDocument/definition", { textDocument: { uri: uri("src/lsp/server.ts") }, position: pos });
const defLoc = Array.isArray(def) ? def[0] : def;
check("definition", !!defLoc?.uri?.endsWith("docs/specs/lsp.md"), defLoc ? defLoc.uri.replace(`file://${root}/`, "") : "null");

// 3. References → counterpart set including both code and doc.
const refs = await request("textDocument/references", { textDocument: { uri: uri("src/lsp/server.ts") }, position: pos });
check("references", Array.isArray(refs) && refs.length > 0, Array.isArray(refs) ? `${refs.length} location(s)` : "null");

// 4. Diagnostics → open a buffer with a broken @doc link, expect a diagnostic.
const badRel = "src/__verify_broken__.ts";
open(badRel, "/**\n * @doc docs/specs/does-not-exist.md#nope\n */\nexport function broken(): void {}\n");
await sleep(400);
const badDiags = diagnostics.get(uri(badRel)) ?? [];
check("diagnostics", badDiags.length > 0, `${badDiags.length} diagnostic(s) on broken link`);

await request("shutdown", null);
send({ method: "exit", params: {} });
console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exitCode = failures === 0 ? 0 : 1;
