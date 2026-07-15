import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverAgentTarget,
  discoverCodeScope,
  discoverDocsScope,
  discoverRepository,
  resolveAgentTargetForInit,
  resolveAgentTargetForInitWithAgent,
} from "./init-discovery";

function makeProject(structure: Record<string, string>): string {
  const project = mkdtempSync(join(tmpdir(), "docbridge-init-discovery-"));
  for (const [relPath, content] of Object.entries(structure)) {
    const absolutePath = join(project, relPath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return project;
}

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
  });
  try {
    const discovery = discoverCodeScope(project);
    expect(discovery.languages.map((entry) => entry.language).toSorted()).toEqual([
      "dart",
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

test("init --yes uses none when no agent directory exists", () => {
  const project = makeProject({});
  try {
    const agent = discoverAgentTarget(project);
    const resolved = resolveAgentTargetForInit(agent, { yes: true, explicitTarget: undefined });
    expect(resolved.target).toBe("none");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("init-with-agent --yes requires an explicit agent target when no agent directory exists", () => {
  const project = makeProject({});
  try {
    const agent = discoverAgentTarget(project);
    const resolved = resolveAgentTargetForInitWithAgent(agent, {
      yes: true,
      explicitTarget: undefined,
    });
    expect(resolved.target).toBeUndefined();
    expect(resolved.error).toContain("explicit agent target");
  } finally {
    rmSync(project, { recursive: true, force: true });
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
