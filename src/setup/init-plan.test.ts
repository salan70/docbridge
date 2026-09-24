import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePackageRoot } from "../core/package-root";
import { makeProject } from "../core/test-support";
import { discoverRepository } from "./init-discovery";
import { buildConfigFromScope, listDistributableSkills, planInitCommand } from "./init-plan";

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

test("listDistributableSkills discovers docbridge and docbridge-* templates", () => {
  const pkg = mkdtempSync(join(tmpdir(), "docbridge-skills-discover-"));
  try {
    mkdirSync(join(pkg, "templates", "skills", "docbridge"), { recursive: true });
    mkdirSync(join(pkg, "templates", "skills", "docbridge-extra"), { recursive: true });
    mkdirSync(join(pkg, "templates", "skills", "other"), { recursive: true });
    writeFileSync(join(pkg, "templates", "skills", "docbridge", "SKILL.md"), "# docbridge\n");
    writeFileSync(join(pkg, "templates", "skills", "docbridge-extra", "SKILL.md"), "# extra\n");
    writeFileSync(join(pkg, "templates", "skills", "other", "SKILL.md"), "# other\n");

    expect(listDistributableSkills(pkg)).toEqual(["docbridge", "docbridge-extra"]);
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});

test("planInitCommand installs the same single skill for init and init-with-agent", () => {
  const project = makeProject({
    ".agents/skills/.keep": "",
    ".claude/skills/.keep": "",
    "docs/specs/cli.md": "# CLI\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const discovery = discoverRepository(project);
    const packageRoot = resolvePackageRoot();
    const initPlan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: "both" },
      discovery,
      packageRoot,
    });
    const agentPlan = planInitCommand({
      command: "init-with-agent",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: "both" },
      discovery,
      packageRoot,
    });

    const expected = [".agents/skills/docbridge", ".claude/skills/docbridge"];
    expect(initPlan.skillOps.map((operation) => operation.path).toSorted()).toEqual(expected);
    expect(agentPlan.skillOps.map((operation) => operation.path).toSorted()).toEqual(expected);
    expect(agentPlan.configOps).toEqual([]);
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

    expect(codex.skillOps[0]?.path).toBe(".agents/skills/docbridge");
    expect(claude.skillOps[0]?.path).toBe(".claude/skills/docbridge");
    expect(both.skillOps.map((operation) => operation.path).toSorted()).toEqual([
      ".agents/skills/docbridge",
      ".claude/skills/docbridge",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("planInitCommand skips existing skills under --yes and overwrites under --force", () => {
  const project = makeProject({
    ".agents/skills/docbridge/SKILL.md": "# existing\n",
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
    const recommendedDocs = discovery.docs.recommended;
    if (recommendedDocs === undefined) {
      throw new Error("Expected an unambiguous docs recommendation");
    }
    const plan = planInitCommand({
      command: "init",
      projectRoot: project,
      options: { root: project, yes: true, dryRun: true, force: false, agentTarget: undefined },
      discovery,
      confirmedScope: {
        docsPattern: recommendedDocs.pattern,
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
    expect(plan.agentGuidance[0]?.destination).toBe(".agents/skills/docbridge/");
    expect(plan.agentGuidance[0]?.oneShotCommand).toContain(project);
    expect(plan.agentGuidance[0]?.oneShotCommand).toContain("adopt DocBridge in this repository");
    expect(plan.agentGuidance[0]?.fallbackPrompt).toContain("docbridge");
    expect(plan.agentGuidance[0]?.fallbackPrompt).not.toContain(
      "install the companion DocBridge skills",
    );
    expect(plan.nextSteps.some((step) => step.includes("docbridge skill"))).toBe(true);
    expect(plan.agentGuidance[1]?.destination).toBe(".claude/skills/docbridge/");
    expect(plan.agentGuidance[1]?.oneShotCommand).toContain(
      "/docbridge adopt DocBridge in this repository",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const LEGACY_SKILL_FIXTURE = {
  ".agents/skills/docbridge-adopt/SKILL.md": "# legacy adopt\n",
  ".agents/skills/docbridge-annotate/SKILL.md": "# legacy annotate\n",
  ".agents/skills/docbridge-link/SKILL.md": "# legacy link\n",
  ".agents/skills/docbridge-review/SKILL.md": "# legacy review\n",
  ".agents/skills/docbridge-sync/SKILL.md": "# legacy sync\n",
};

test("planInitCommand dry-run --force would-remove leftover legacy skill directories", () => {
  const project = makeProject(LEGACY_SKILL_FIXTURE);
  try {
    const discovery = discoverRepository(project);
    const plan = planInitCommand({
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

    const removals = plan.skillOps.filter((operation) => operation.action === "would-remove");
    expect(removals.map((operation) => operation.path).toSorted()).toEqual([
      ".agents/skills/docbridge-adopt",
      ".agents/skills/docbridge-annotate",
      ".agents/skills/docbridge-link",
      ".agents/skills/docbridge-review",
      ".agents/skills/docbridge-sync",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
