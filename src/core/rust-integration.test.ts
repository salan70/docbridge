import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { definition, references } from "../lsp/navigation";
import { Project } from "../lsp/project";
import { context, formatContextResult } from "./context";
import { graph } from "./graph-output";
import { check } from "./resolver";

function withRustProject(run: (root: string) => void): void {
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
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Rust worker participates in check, context, graph, and LSP navigation", () => {
  withRustProject((root) => {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);

    const contextResult = context({
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

    const graphResult = graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "src/auth_service.rs#AuthService::login",
        language: "rust",
      });
    }

    const project = new Project(root);
    const state = project.resolve();
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
