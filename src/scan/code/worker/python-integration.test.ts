import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { formatContextResult } from "../../../cli/render/context";
import { hover } from "../../../lsp/hover";
import { definition, references } from "../../../lsp/navigation";
import { Project } from "../../../lsp/project";
import { check } from "../../../query/check";
import { context } from "../../../query/context";
import { graph } from "../../../query/graph-output";
import { makeProject } from "../../../test-support";

/**
 * Runs the real Python worker through the registered adapter with the CPython
 * the dev shell puts on `PATH`; a missing runtime fails these tests, as a
 * missing native worker binary fails the other integration tests.
 */

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../../../examples/python");

const CONFIG = JSON.stringify({
  include: { code: { python: { patterns: ["src/**/*.py"] } }, docs: ["docs/**/*.md"] },
});

const SERVICE = [
  "class AuthService:",
  '    """The authentication service."""',
  "",
  "    # Starts the login flow.",
  "    #",
  "    # @doc docs/auth.md#login-flow",
  "    def login(self, email: str, password: str) -> None:",
  "        pass",
  "",
].join("\n");

const DOC = "<!-- @code src/auth/service.py#AuthService.login -->\n## Login Flow\n";

test("the Python worker participates in check, context, graph, and LSP navigation", () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "src/auth/service.py": SERVICE,
    "docs/auth.md": DOC,
  });
  try {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);

    const contextResult = context({ projectRoot: root, inputFiles: ["docs/auth.md"] });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain(
        "```python\n# Starts the login flow.",
      );
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "src/auth/service.py#AuthService.login",
        kind: "code",
        language: "python",
      });
    }

    const graphResult = graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "src/auth/service.py#AuthService.login",
        language: "python",
      });
    }

    const state = new Project(root).resolve();
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "src/auth/service.py",
        range: { start: { line: 7, column: 9 }, end: { line: 7, column: 14 } },
      },
    ]);
    expect(references(state, "src/auth/service.py", { line: 7, column: 10 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
    expect(hover(state, "docs/auth.md", { line: 2, column: 5 })?.value).toBe(
      "**src/auth/service.py#AuthService.login**\n\n```python\ndef login(self, email: str, password: str) -> None:\n```",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Python manifest entry links a method with no annotation", () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/auth/service.py#AuthService.logout", doc: "docs/auth.md#logout" }],
    }),
    "src/auth/service.py": "class AuthService:\n    def logout(self) -> None:\n        pass\n",
    "docs/auth.md": "## Logout\n",
  });
  try {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Python worker ignores interpreter variables that load code or options", () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "src/auth/service.py": SERVICE,
    "docs/auth.md": DOC,
  });
  const saved = { PYTHONPATH: process.env.PYTHONPATH, PYTHONSTARTUP: process.env.PYTHONSTARTUP };
  process.env.PYTHONPATH = "/nonexistent-docbridge-path";
  process.env.PYTHONSTARTUP = "/nonexistent-startup.py";
  try {
    expect(check({ projectRoot: root }).diagnostics).toEqual([]);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("a configured Python runtime that does not exist fails every file without fallback", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: { code: { python: { patterns: ["src/**/*.py"] } }, docs: ["docs/**/*.md"] },
      scanners: { python: { command: ["tools/missing-python"] } },
    }),
    "src/a.py": "def a():\n    pass\n",
    "src/b.py": "def b():\n    pass\n",
    "docs/auth.md": "## Auth\n",
  });
  try {
    const diagnostics = check({ projectRoot: root }).diagnostics;

    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.target])).toEqual([
      ["code_scanner_unavailable", "src/a.py"],
      ["code_scanner_unavailable", "src/b.py"],
    ]);
    expect(diagnostics[0]).toMatchObject({
      language: "python",
      message: expect.stringContaining("scanners.python.command"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Python example project passes check and audit", () => {
  expect(check({ projectRoot: EXAMPLE_ROOT, audit: true }).diagnostics).toEqual([]);

  const graphOutcome = graph({ projectRoot: EXAMPLE_ROOT });
  expect(graphOutcome.ok).toBe(true);
  if (graphOutcome.ok) {
    expect(graphOutcome.result.pairs.map((pair) => pair.codeEndpoint).toSorted()).toEqual([
      "src/auth/service.py#AuthService",
      "src/auth/service.py#AuthService.__init__",
      "src/auth/service.py#AuthService.login",
      "src/auth/service.py#AuthService.timeout",
      "src/auth/service.py#Authenticator",
      "src/auth/service.py#Authenticator.authenticate",
    ]);
  }
});

test("the Language Server scans the Python example asynchronously with the same result", async () => {
  const state = await new Project(EXAMPLE_ROOT).resolveAsync().promise;

  expect(state.contentByFile.has("src/auth/service.py")).toBe(true);
  expect(state).toEqual(new Project(EXAMPLE_ROOT).resolve());
});
