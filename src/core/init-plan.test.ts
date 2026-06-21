import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverRepository } from "./init-discovery";
import {
  buildConfigFromScope,
  listDistributableSkills,
  planInitCommand,
  resolvePackageRoot,
} from "./init-plan";
import { resolveConfig } from "./config";

function makeProject(structure: Record<string, string>): string {
  const project = mkdtempSync(join(tmpdir(), "docbridge-init-plan-"));
  for (const [relPath, content] of Object.entries(structure)) {
    const absolutePath = join(project, relPath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return project;
}

test("buildConfigFromScope uses the language-keyed include.code object", () => {
  const config = buildConfigFromScope({
    docsPattern: "docs/specs/**/*.md",
    languages: [
      { language: "typescript", patterns: ["src/**/*.ts"], fileCount: 1 },
      { language: "swift", patterns: ["Sources/**/*.swift"], fileCount: 1 },
    ],
  });

  expect(config).toEqual({
    include: {
      code: {
        typescript: { patterns: ["src/**/*.ts"] },
        swift: { patterns: ["Sources/**/*.swift"] },
      },
      docs: ["docs/specs/**/*.md"],
    },
  });
});

test("planInitCommand creates a new config for unambiguous --yes discovery", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: false, force: false, agentTarget: undefined },
      discovery,
      confirmedScope: {
        docsPattern: discovery.docs.recommended!.pattern,
        languages: discovery.code.languages,
      },
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.configOps).toEqual([
      expect.objectContaining({
        action: "create",
        path: "docbridge.config.json",
      }),
    ]);
    const parsed = resolveConfig(plan.configOps[0]?.content);
    expect(parsed.ok).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand never overwrites an existing config", () => {
  const project = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/specs/**/*.md"],
      },
    }),
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: false, force: true, agentTarget: undefined },
      discovery,
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.configOps).toEqual([]);
    expect(plan.messages.some((message) => message.includes("left unchanged"))).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand does not create config for ambiguous --yes discovery", () => {
  const project = makeProject({ "README.md": "# Project\n" });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: false, force: false, agentTarget: undefined },
      discovery,
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.configOps).toEqual([]);
    expect(plan.exitCode).toBe(1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand dry-run reports config content without requiring writes", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      discovery,
      confirmedScope: {
        docsPattern: discovery.docs.recommended!.pattern,
        languages: discovery.code.languages,
      },
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.configOps[0]?.action).toBe("would-create");
    expect(existsSync(join(project, "docbridge.config.json"))).toBe(false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand installs every DocBridge skill for init", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const packageRoot = resolvePackageRoot();
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      discovery,
      packageRoot,
    });

    const expectedSkills = listDistributableSkills(packageRoot);
    expect(plan.skillOps.map((operation) => operation.path)).toEqual(
      expectedSkills.map((skill) => `.agents/skills/${skill}`),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand installs only docbridge-adopt for init-with-agent", () => {
  const project = makeProject({ ".claude/skills/.keep": "" });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      discovery,
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.skillOps.map((operation) => operation.path)).toEqual([
      ".claude/skills/docbridge-adopt",
    ]);
    expect(plan.configOps).toEqual([]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand maps codex, claude, and both to the right destination paths", () => {
  const project = makeProject({});
  try {
    const discovery = discoverRepository(project);
    const packageRoot = resolvePackageRoot();
    const codex = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: {
        root: project,
        yes: true,
        dryRun: true,
        force: false,
        agentTarget: "codex",
      },
      discovery,
      packageRoot,
    });
    const claude = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: {
        root: project,
        yes: true,
        dryRun: true,
        force: false,
        agentTarget: "claude",
      },
      discovery,
      packageRoot,
    });
    const both = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: {
        root: project,
        yes: true,
        dryRun: true,
        force: false,
        agentTarget: "both",
      },
      discovery,
      packageRoot,
    });

    expect(codex.skillOps[0]?.path).toBe(".agents/skills/docbridge-adopt");
    expect(claude.skillOps[0]?.path).toBe(".claude/skills/docbridge-adopt");
    expect(both.skillOps.map((operation) => operation.path).sort()).toEqual([
      ".agents/skills/docbridge-adopt",
      ".claude/skills/docbridge-adopt",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand skips existing skills under --yes and overwrites under --force", () => {
  const project = makeProject({
    ".agents/skills/docbridge-adopt/SKILL.md": "# existing\n",
  });
  try {
    const discovery = discoverRepository(project);
    const skipped = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: {
        root: project,
        yes: true,
        dryRun: true,
        force: false,
        agentTarget: "codex",
      },
      discovery,
      packageRoot: resolvePackageRoot(),
    });
    const forced = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: {
        root: project,
        yes: true,
        dryRun: true,
        force: true,
        agentTarget: "codex",
      },
      discovery,
      packageRoot: resolvePackageRoot(),
    });

    expect(skipped.skillOps[0]?.action).toBe("skip");
    expect(forced.skillOps[0]?.action).toBe("would-overwrite");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand does not plan skill writes for init --yes with no agent directory", () => {
  const project = makeProject({
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      discovery,
      confirmedScope: {
        docsPattern: discovery.docs.recommended!.pattern,
        languages: discovery.code.languages,
      },
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.skillOps).toEqual([]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand prints agent guidance for init-with-agent", () => {
  const project = makeProject({ ".agents/skills/.keep": "", ".claude/skills/.keep": "" });
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: "both" },
      discovery,
      packageRoot: resolvePackageRoot(),
    });

    expect(plan.agentGuidance.map((entry) => entry.agent)).toEqual(["codex", "claude"]);
    expect(plan.agentGuidance[0]?.destination).toBe(".agents/skills/docbridge-adopt/");
    expect(plan.agentGuidance[0]?.oneShotCommand).toContain(project);
    expect(plan.agentGuidance[0]?.fallbackPrompt).toContain("docbridge-adopt");
    expect(plan.agentGuidance[1]?.destination).toBe(".claude/skills/docbridge-adopt/");
    expect(plan.agentGuidance[1]?.oneShotCommand).toContain("/docbridge-adopt");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
