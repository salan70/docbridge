import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatContextResult } from "../../../cli/render/context";
import { definition, references } from "../../../lsp/navigation";
import { Project } from "../../../lsp/project";
import { check } from "../../../query/check";
import { context } from "../../../query/context";
import { graph } from "../../../query/graph-output";

async function withRustProject(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "docbridge-rust-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { rust: { patterns: ["src/**/*.rs"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "src", "auth_service.rs"),
      [
        "pub struct AuthService;",
        "",
        "impl AuthService {",
        "  /// @doc docs/auth.md#login-flow",
        "  pub fn login(&self, email: &str, password: &str) {}",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docs", "auth.md"),
      ["<!-- @code src/auth_service.rs#AuthService::login -->", "## Login Flow", ""].join("\n"),
    );
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Rust worker participates in check, context, graph, and LSP navigation", async () => {
  await withRustProject(async (root) => {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const contextResult = await context({
      projectRoot: root,
      inputFiles: ["docs/auth.md"],
    });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain("```rust");
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "src/auth_service.rs#AuthService::login",
        kind: "code",
        language: "rust",
      });
    }

    const graphResult = await graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "src/auth_service.rs#AuthService::login",
        language: "rust",
      });
    }

    const project = new Project(root);
    const state = await project.resolveAsync().promise;
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "src/auth_service.rs",
        range: { start: { line: 5, column: 10 }, end: { line: 5, column: 15 } },
      },
    ]);
    expect(references(state, "src/auth_service.rs", { line: 5, column: 11 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
  });
});

test("Rust manifest entry links a member with no annotation", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-rust-manifest-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { rust: { patterns: ["src/**/*.rs"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "docbridge.links.json"),
      JSON.stringify({
        links: [{ code: "src/auth_service.rs#AuthService::login", doc: "docs/auth.md#login-flow" }],
      }),
    );
    writeFileSync(
      join(root, "src", "auth_service.rs"),
      [
        "pub struct AuthService;",
        "",
        "impl AuthService {",
        "  pub fn login(&self, email: &str, password: &str) {}",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(join(root, "docs", "auth.md"), "## Login Flow\n");

    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const graphOutcome = await graph({ projectRoot: root });
    expect(graphOutcome.ok).toBe(true);
    if (!graphOutcome.ok) {
      return;
    }
    expect(graphOutcome.result.pairs).toEqual([
      {
        codeEndpoint: "src/auth_service.rs#AuthService::login",
        docEndpoint: "docs/auth.md#login-flow",
        hasDocEdge: true,
        hasCodeEdge: true,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
