import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { documentUri, startLspSession, type LspSession } from "./lsp-client";

const repoRoot = resolve(import.meta.dir, "..");

let projectRoot: string;
let session: LspSession;

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "docbridge-lsp-client-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  mkdirSync(join(projectRoot, "docs"), { recursive: true });
  writeFileSync(
    join(projectRoot, "docbridge.config.json"),
    JSON.stringify({
      include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.md"] },
    }),
  );
  writeFileSync(
    join(projectRoot, "src/auth.ts"),
    "/**\n * @doc docs/auth.md#auth-service\n */\nexport function authService() {}\n",
  );
  writeFileSync(
    join(projectRoot, "docs/auth.md"),
    "<!-- @code src/auth.ts#authService -->\n\n## Auth Service\n",
  );

  session = startLspSession(["bun", "run", "src/cli/index.ts", "lsp"], repoRoot);
  await session.initialize(projectRoot);
});

afterAll(async () => {
  await session?.stop();
  rmSync(projectRoot, { recursive: true, force: true });
});

test("initialize advertises the capabilities the DocBridge client binds to", () => {
  expect(session.capabilities()).toMatchObject({
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
  });
});

test("hover on a linked symbol reaches the Markdown section it documents", async () => {
  const uri = documentUri(join(projectRoot, "src/auth.ts"));
  session.openDocument(
    uri,
    "typescript",
    "/**\n * @doc docs/auth.md#auth-service\n */\nexport function authService() {}\n",
  );

  const hover = await session.request<{ contents?: { value?: string } } | null>(
    "textDocument/hover",
    { textDocument: { uri }, position: { line: 3, character: 18 } },
  );

  expect(hover?.contents?.value).toContain("Auth Service");
});

test("a broken @doc target publishes a diagnostic on the document that carries it", async () => {
  const uri = documentUri(join(projectRoot, "src/broken.ts"));
  session.openDocument(
    uri,
    "typescript",
    "/**\n * @doc docs/does-not-exist.md#nope\n */\nexport function broken() {}\n",
  );

  await expect(session.waitForDiagnostics(uri)).resolves.not.toHaveLength(0);
});
