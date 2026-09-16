// Editor-independent verification of the DocBridge language server.
// Drives `docbridge lsp` over stdio and checks hover, definition, references,
// and diagnostics against the repo's own dogfooded links. Run with:
//   bun run scripts/lsp-verify.ts
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { documentUri, startLspSession } from "./lsp-client";

const root = resolve(import.meta.dir, "..");
const session = startLspSession(["bun", "run", "src/cli/index.ts", "lsp"], root);
const uri = (relative: string) => documentUri(join(root, relative));

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) {
    failures++;
  }
}

const serverTs = readFileSync(join(root, "src/lsp/server.ts"), "utf8");
const lines = serverTs.split("\n");
const line = lines.findIndex((l) => l.includes("export class Server"));
const character = (lines[line] ?? "").indexOf("Server") + 2;
const pos = { line, character };

await session.initialize(root);
session.openDocument(uri("src/lsp/server.ts"), "typescript", serverTs);

// 1. Hover on the `Server` class → spec section from lsp.md.
const hover = await session.request<{ contents?: { value?: string } } | null>(
  "textDocument/hover",
  { textDocument: { uri: uri("src/lsp/server.ts") }, position: pos },
);
check(
  "hover",
  typeof hover?.contents?.value === "string" && hover.contents.value.includes("Lifecycle"),
  hover ? `returned ${hover.contents?.value?.length ?? 0} chars` : "null",
);

// 2. Definition on the same symbol → jumps into docs/specs/lsp.md.
const def = await session.request<{ uri?: string } | { uri?: string }[] | null>(
  "textDocument/definition",
  { textDocument: { uri: uri("src/lsp/server.ts") }, position: pos },
);
const defLoc = Array.isArray(def) ? def[0] : def;
check(
  "definition",
  !!defLoc?.uri?.endsWith("docs/specs/lsp.md"),
  defLoc?.uri ? defLoc.uri.replace(`${documentUri(root)}/`, "") : "null",
);

// 3. References → counterpart set including both code and doc.
const refs = await session.request<unknown[]>("textDocument/references", {
  textDocument: { uri: uri("src/lsp/server.ts") },
  position: pos,
});
check(
  "references",
  Array.isArray(refs) && refs.length > 0,
  Array.isArray(refs) ? `${refs.length} location(s)` : "null",
);

// 4. Diagnostics → open a buffer with a broken @doc link, expect a diagnostic.
const brokenUri = uri("src/__verify_broken__.ts");
session.openDocument(
  brokenUri,
  "typescript",
  "/**\n * @doc docs/specs/does-not-exist.md#nope\n */\nexport function broken(): void {}\n",
);
const brokenDiagnostics = await session.waitForDiagnostics(brokenUri);
check(
  "diagnostics",
  brokenDiagnostics.length > 0,
  `${brokenDiagnostics.length} diagnostic(s) on broken link`,
);

await session.stop();
console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exitCode = failures === 0 ? 0 : 1;
