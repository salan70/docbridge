import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { formatContextResult } from "../../../cli/render/context";
import { hover } from "../../../lsp/hover";
import { definition, references } from "../../../lsp/navigation";
import { Project } from "../../../lsp/project";
import { check } from "../../../query/check";
import { context } from "../../../query/context";
import { graph } from "../../../query/graph-output";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../../../examples/go");

async function withGoProject(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "docbridge-go-"));
  try {
    mkdirSync(join(root, "internal/auth"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { go: { patterns: ["internal/**/*.go"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "internal/auth", "service.go"),
      [
        "package auth",
        "",
        "type Service struct{}",
        "",
        "// Login starts the login flow.",
        "//",
        "// @doc docs/auth.md#login-flow",
        "func (s *Service) Login(email, password string) error {",
        "\treturn nil",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docs", "auth.md"),
      ["<!-- @code internal/auth/service.go#Service.Login -->", "## Login Flow", ""].join("\n"),
    );
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Go worker participates in check, context, graph, and LSP navigation", async () => {
  await withGoProject(async (root) => {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const contextResult = await context({
      projectRoot: root,
      inputFiles: ["docs/auth.md"],
    });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain("```go");
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "internal/auth/service.go#Service.Login",
        kind: "code",
        language: "go",
      });
    }

    const graphResult = await graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "internal/auth/service.go#Service.Login",
        language: "go",
      });
    }

    const project = new Project(root);
    const state = await project.resolveAsync().promise;
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "internal/auth/service.go",
        range: { start: { line: 8, column: 19 }, end: { line: 8, column: 24 } },
      },
    ]);
    expect(references(state, "internal/auth/service.go", { line: 8, column: 20 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);

    const hovered = hover(state, "docs/auth.md", { line: 2, column: 5 });
    expect(hovered?.value).toBe(
      "**internal/auth/service.go#Service.Login**\n\n```go\nfunc (s *Service) Login(email, password string) error\n```",
    );
  });
});

test("Go manifest entry links a method with no annotation", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-go-manifest-"));
  try {
    mkdirSync(join(root, "internal/auth"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { go: { patterns: ["internal/**/*.go"] } },
          docs: ["docs/**/*.md"],
        },
      }),
    );
    writeFileSync(
      join(root, "docbridge.links.json"),
      JSON.stringify({
        links: [{ code: "internal/auth/service.go#Service.Login", doc: "docs/auth.md#login-flow" }],
      }),
    );
    writeFileSync(
      join(root, "internal/auth", "service.go"),
      [
        "package auth",
        "",
        "type Service struct{}",
        "",
        "func (s *Service) Login(email, password string) error { return nil }",
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
        codeEndpoint: "internal/auth/service.go#Service.Login",
        docEndpoint: "docs/auth.md#login-flow",
        hasDocEdge: true,
        hasCodeEdge: true,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Go example project passes check and audit", async () => {
  const result = await check({ projectRoot: EXAMPLE_ROOT, audit: true });
  expect(result.diagnostics).toEqual([]);

  const graphOutcome = await graph({ projectRoot: EXAMPLE_ROOT });
  expect(graphOutcome.ok).toBe(true);
  if (!graphOutcome.ok) {
    return;
  }
  expect(graphOutcome.result.pairs.map((pair) => pair.codeEndpoint).toSorted()).toEqual([
    "internal/auth/service.go#AuthService",
    "internal/auth/service.go#AuthService.Login",
    "internal/auth/service.go#Authenticator",
    "internal/auth/service.go#Authenticator.Authenticate",
    "internal/auth/service.go#MaxAttempts",
    "internal/auth/service.go#NewAuthService",
  ]);
});

test("the Language Server scans the Go example asynchronously with the same result", async () => {
  const project = new Project(EXAMPLE_ROOT);

  const state = await project.resolveAsync().promise;

  expect(state.contentByFile.has("internal/auth/service.go")).toBe(true);
  expect(state).toEqual(await new Project(EXAMPLE_ROOT).resolveAsync().promise);
});
