import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { makeProject } from "../test-support";
import {
  discoverAgentTarget,
  discoverCodeScope,
  discoverDocsScope,
  discoverRepository,
} from "./init-discovery";

test("discoverDocsScope recommends a strong docs directory", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "docs/specs/config.md": "# Config\n",
    "docs/notes.md": "# Notes\n",
  });
  try {
    const discovery = discoverDocsScope(project);
    expect(discovery.ambiguous).toBe(false);
    expect(discovery.recommended).toEqual({
      directory: "docs/specs",
      pattern: "docs/specs/**/*.md",
      score: 2,
      fileCount: 2,
    });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverDocsScope treats README-only repositories as ambiguous", () => {
  const project = makeProject({
    "README.md": "# Project\n",
  });
  try {
    const discovery = discoverDocsScope(project);
    expect(discovery.ambiguous).toBe(true);
    expect(discovery.recommended).toBeUndefined();
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverDocsScope excludes default prose basenames case-insensitively", () => {
  const project = makeProject({
    "docs/specs/readme.md": "# Readme\n",
    "docs/specs/CHANGELOG.MD": "# Changelog\n",
    "docs/specs/cli.md": "# CLI\n",
  });
  try {
    const discovery = discoverDocsScope(project);
    expect(discovery.recommended?.fileCount).toBe(1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverDocsScope excludes operational markdown directories", () => {
  const project = makeProject({
    "docs/runbooks/deploy.md": "# Deploy\n",
    "docs/specs/cli.md": "# CLI\n",
  });
  try {
    const discovery = discoverDocsScope(project);
    expect(discovery.recommended?.directory).toBe("docs/specs");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverCodeScope proposes every supported language in mixed-language repositories", () => {
  const project = makeProject({
    "src/app.ts": "export const app = 1;\n",
    "Sources/App.swift": "public struct App {}\n",
    "lib/app.dart": "class App {}\n",
    "crate/src/lib.rs": "pub fn app() {}\n",
    "cmd/app/main.go": "package main\n",
  });
  try {
    const discovery = discoverCodeScope(project);
    expect(discovery.languages.map((entry) => entry.language).toSorted()).toEqual([
      "dart",
      "go",
      "rust",
      "swift",
      "typescript",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverCodeScope excludes tests and declaration files from detection", () => {
  const project = makeProject({
    "src/app.test.ts": "test();\n",
    "src/app.d.ts": "export {};\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverCodeScope(project);
    expect(discovery.languages[0]?.fileCount).toBe(1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverCodeScope proposes every TypeScript suffix that has non-test source files", () => {
  const project = makeProject({
    "src/app.ts": "export const app = 1;\n",
    "src/view.tsx": "export const view = 1;\n",
    "src/view.test.tsx": "test();\n",
    "src/module.spec.mts": "test();\n",
    "src/types.d.mts": "export {};\n",
    "lib/common.cts": "export const common = 1;\n",
  });
  try {
    const discovery = discoverCodeScope(project);
    const typescript = discovery.languages.find((entry) => entry.language === "typescript");
    expect(typescript?.patterns).toEqual(["src/**/*.ts", "src/**/*.tsx", "lib/**/*.cts"]);
    expect(typescript?.fileCount).toBe(3);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverCodeScope proposes JavaScript source roots apart from TypeScript", () => {
  const project = makeProject({
    "src/app.ts": "export const app = 1;\n",
    "src/legacy.js": "export const legacy = 1;\n",
    "src/view.jsx": "export const View = () => null;\n",
    "src/view.test.jsx": "test();\n",
    "src/__tests__/helper.js": "test();\n",
    "packages/cli/src/main.mjs": "export const main = 1;\n",
    "lib/config.cjs": "module.exports = {};\n",
    "lib/config.spec.cjs": "test();\n",
  });
  try {
    const discovery = discoverCodeScope(project);
    const javascript = discovery.languages.find((entry) => entry.language === "javascript");
    expect(javascript?.patterns).toEqual([
      "src/**/*.js",
      "src/**/*.jsx",
      "lib/**/*.cjs",
      "packages/*/src/**/*.mjs",
    ]);
    expect(javascript?.fileCount).toBe(4);
    expect(discovery.languages.find((entry) => entry.language === "typescript")?.patterns).toEqual([
      "src/**/*.ts",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverCodeScope keeps only the Go layout patterns that match non-test files", () => {
  const project = makeProject({
    "main.go": "package main\n",
    "internal/auth/service.go": "package auth\n",
    "internal/auth/service_test.go": "package auth\n",
    "internal/auth/testdata/fixture.go": "package fixture\n",
    "vendor/dep/dep.go": "package dep\n",
    "pkg/only/only_test.go": "package only\n",
  });
  try {
    const discovery = discoverCodeScope(project);
    const go = discovery.languages.find((entry) => entry.language === "go");
    expect(go?.patterns).toEqual(["*.go", "internal/**/*.go"]);
    expect(go?.fileCount).toBe(2);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("discoverAgentTarget follows directory detection rules", () => {
  const agentsOnly = makeProject({ ".agents/skills/.keep": "" });
  const claudeOnly = makeProject({ ".claude/skills/.keep": "" });
  const both = makeProject({ ".agents/skills/.keep": "", ".claude/skills/.keep": "" });
  const neither = makeProject({ "README.md": "# Project\n" });
  try {
    expect(discoverAgentTarget(agentsOnly).defaultTarget).toBe("codex");
    expect(discoverAgentTarget(claudeOnly).defaultTarget).toBe("claude");
    expect(discoverAgentTarget(both).defaultTarget).toBe("both");
    expect(discoverAgentTarget(neither).defaultTarget).toBe("none");
    expect(discoverAgentTarget(neither).recommendedTarget).toBe("codex");
  } finally {
    rmSync(agentsOnly, { recursive: true, force: true });
    rmSync(claudeOnly, { recursive: true, force: true });
    rmSync(both, { recursive: true, force: true });
    rmSync(neither, { recursive: true, force: true });
  }
});

test("discoverRepository returns structured ambiguity without throwing", () => {
  const project = makeProject({ "README.md": "# Project\n" });
  try {
    const discovery = discoverRepository(project);
    expect(discovery.docs.ambiguous).toBe(true);
    expect(discovery.code.ambiguous).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
