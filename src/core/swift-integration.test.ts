import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check } from "./resolver";
import { context, formatContextResult } from "./context";
import { graph } from "./graph-output";
import { Project } from "../lsp/project";
import { definition, references } from "../lsp/navigation";

function withSwiftProject(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-swift-"));
  try {
    mkdirSync(join(root, "Sources"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { swift: { patterns: ["Sources/**/*.swift"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "Sources", "AuthService.swift"),
      [
        "public struct AuthService {",
        "  /// @doc docs/auth.md#login-flow",
        "  public func login(email: String, password: String) {}",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docs", "auth.md"),
      [
        "<!-- @code Sources/AuthService.swift#AuthService.login(email:password:) -->",
        "## Login Flow",
        "",
      ].join("\n"),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Swift worker participates in check, context, graph, and LSP navigation", () => {
  withSwiftProject((root) => {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);

    const contextResult = context({
      projectRoot: root,
      inputFiles: ["docs/auth.md"],
    });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain("```swift");
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "Sources/AuthService.swift#AuthService.login(email:password:)",
        kind: "code",
        language: "swift",
      });
    }

    const graphResult = graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "Sources/AuthService.swift#AuthService.login(email:password:)",
        language: "swift",
      });
    }

    const project = new Project(root);
    const state = project.resolve();
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "Sources/AuthService.swift",
        range: { start: { line: 3, column: 15 }, end: { line: 3, column: 20 } },
      },
    ]);
    expect(references(state, "Sources/AuthService.swift", { line: 3, column: 16 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
  });
});
