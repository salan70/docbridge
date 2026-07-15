import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { definition, references } from "../lsp/navigation";
import { Project } from "../lsp/project";
import { context, formatContextResult } from "./context";
import { graph } from "./graph-output";
import { check } from "./resolver";

function withDartProject(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-dart-"));
  try {
    mkdirSync(join(root, "lib"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { dart: { patterns: ["lib/**/*.dart"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "lib", "auth_service.dart"),
      [
        "class AuthService {",
        "  /// @doc docs/auth.md#login-flow",
        "  void login(String email, String password) {}",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docs", "auth.md"),
      ["<!-- @code lib/auth_service.dart#AuthService.login -->", "## Login Flow", ""].join("\n"),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Dart worker participates in check, context, graph, and LSP navigation", () => {
  withDartProject((root) => {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);

    const contextResult = context({
      projectRoot: root,
      inputFiles: ["docs/auth.md"],
    });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain("```dart");
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "lib/auth_service.dart#AuthService.login",
        kind: "code",
        language: "dart",
      });
    }

    const graphResult = graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "lib/auth_service.dart#AuthService.login",
        language: "dart",
      });
    }

    const project = new Project(root);
    const state = project.resolve();
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "lib/auth_service.dart",
        range: { start: { line: 3, column: 8 }, end: { line: 3, column: 13 } },
      },
    ]);
    expect(references(state, "lib/auth_service.dart", { line: 3, column: 9 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
  });
});
