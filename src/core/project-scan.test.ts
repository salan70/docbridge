import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { definition } from "../lsp/navigation";
import { Project } from "../lsp/project";
import { scanProject } from "./project-scan";
import { makeProject } from "./test-support";

test("scanProject omits graph and content artifacts by default", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "src/login.ts": "/** @doc docs/auth.md#login-spec */\nexport function login() {}\n",
    "docs/auth.md": "<!-- @code src/login.ts#login -->\n## Login Spec\n",
  });

  try {
    const outcome = scanProject({ projectRoot: root });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.scan.diagnostics).toEqual([]);
    expect("graph" in outcome.scan).toBe(false);
    expect("contentByFile" in outcome.scan).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProject stops scanning when the manifest is invalid", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": '{ "links": [], }',
    "src/login.ts": "export function login() {}\n",
  });

  try {
    const outcome = scanProject({ projectRoot: root });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0]?.code).toBe("config_file_invalid");
    expect(outcome.diagnostics[0]?.target).toBe("docbridge.links.json");
    expect(outcome.diagnostics[0]?.location?.line).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LSP navigation follows a manifest link in both directions", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/login.ts#login", doc: "docs/auth.md#login-spec" }],
    }),
    "src/login.ts": "export function login() {}\n",
    "docs/auth.md": "## Login Spec\n",
  });

  try {
    const state = new Project(root).resolve();

    expect(definition(state, "src/login.ts", { line: 1, column: 18 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 1, column: 4 }, end: { line: 1, column: 14 } },
      },
    ]);
    expect(definition(state, "docs/auth.md", { line: 1, column: 5 })).toEqual([
      {
        filePath: "src/login.ts",
        range: { start: { line: 1, column: 17 }, end: { line: 1, column: 22 } },
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
