import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { formatContextResult } from "../../cli/render/context";
import { hover } from "../../lsp/hover";
import { definition, references } from "../../lsp/navigation";
import { Project } from "../../lsp/project";
import { check } from "../../query/check";
import { context } from "../../query/context";
import { graph } from "../../query/graph-output";
import { makeProject } from "../../test-support";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../../examples/javascript");

const CONFIG = JSON.stringify({
  include: {
    code: { javascript: { patterns: ["src/**/*.js", "src/**/*.jsx"] } },
    docs: ["docs/**/*.md"],
  },
});

const SERVICE = [
  "export class AuthService {",
  "  /**",
  "   * Starts the login flow.",
  "   *",
  "   * @doc docs/auth.md#login-flow",
  "   */",
  "  login(email, password) {",
  "    return email !== password;",
  "  }",
  "}",
  "",
].join("\n");

const FORM = [
  "/** @doc docs/auth.md#login-form */",
  "export const LoginForm = () => <form />;",
  "",
].join("\n");

const DOC = [
  "<!-- @code src/auth/service.js#AuthService.login -->",
  "## Login Flow",
  "",
  "<!-- @code src/ui/login-form.jsx#LoginForm -->",
  "## Login Form",
  "",
].join("\n");

test("JavaScript participates in check, context, graph, and LSP navigation", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "src/auth/service.js": SERVICE,
    "src/ui/login-form.jsx": FORM,
    "docs/auth.md": DOC,
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const contextResult = await context({ projectRoot: root, inputFiles: ["docs/auth.md"] });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      const rendered = formatContextResult(contextResult.result);
      expect(rendered).toContain("```js\n/**\n * Starts the login flow.");
      expect(rendered).toContain("```jsx\n/** @doc docs/auth.md#login-form */");
      expect(contextResult.result.contexts.map((block) => block.language)).toEqual([
        "javascript",
        "javascript",
      ]);
    }

    const graphResult = await graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(
        graphResult.result.nodes
          .filter((node) => node.kind === "code")
          .map((node) => [node.endpoint, node.language]),
      ).toEqual([
        ["src/auth/service.js#AuthService.login", "javascript"],
        ["src/ui/login-form.jsx#LoginForm", "javascript"],
      ]);
    }

    const state = await new Project(root).resolveAsync().promise;
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "src/auth/service.js",
        range: { start: { line: 7, column: 3 }, end: { line: 7, column: 8 } },
      },
    ]);
    expect(references(state, "src/ui/login-form.jsx", { line: 2, column: 14 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 5, column: 4 }, end: { line: 5, column: 14 } },
      },
    ]);
    expect(hover(state, "docs/auth.md", { line: 2, column: 5 })?.value).toBe(
      "**src/auth/service.js#AuthService.login**\n\n```js\nlogin(email, password)\n```",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a JavaScript manifest entry links an export with no annotation", async () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: { code: { javascript: { patterns: ["src/**/*.mjs"] } }, docs: ["docs/**/*.md"] },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/auth/session.mjs#refresh", doc: "docs/auth.md#refresh" }],
    }),
    "src/auth/session.mjs": "export function refresh(token) {\n  return token;\n}\n",
    "docs/auth.md": "## Refresh\n",
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the JavaScript example project passes check and audit", async () => {
  expect((await check({ projectRoot: EXAMPLE_ROOT, audit: true })).diagnostics).toEqual([]);

  const graphOutcome = await graph({ projectRoot: EXAMPLE_ROOT });
  expect(graphOutcome.ok).toBe(true);
  if (graphOutcome.ok) {
    expect(graphOutcome.result.pairs.map((pair) => pair.codeEndpoint).toSorted()).toEqual([
      "src/auth/service.js#AuthService",
      "src/auth/service.js#AuthService.constructor",
      "src/auth/service.js#AuthService.login",
      "src/auth/service.js#MAX_ATTEMPTS",
      "src/ui/login-form.jsx#LoginForm",
    ]);
  }
});

test("the Language Server scans the JavaScript example asynchronously with the same result", async () => {
  const state = await new Project(EXAMPLE_ROOT).resolveAsync().promise;

  expect(state.contentByFile.has("src/ui/login-form.jsx")).toBe(true);
  expect(state).toEqual(await new Project(EXAMPLE_ROOT).resolveAsync().promise);
});
