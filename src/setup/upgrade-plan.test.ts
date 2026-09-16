import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverRepository } from "./init-discovery";
import type { LatestVersionLookup } from "./registry";
import { detectUpgradeGuidance } from "./upgrade-guidance";
import {
  formatUpgradePlan,
  inspectLegacySkills,
  inspectManagedSkill,
  planUpgrade,
  reportCliVersion,
  resolveUpgradeAgentTarget,
  type UpgradeOptions,
} from "./upgrade-plan";

const LEGACY_NAMES = [
  "docbridge-adopt",
  "docbridge-annotate",
  "docbridge-link",
  "docbridge-review",
  "docbridge-sync",
] as const;

type Fixture = {
  projectRoot: string;
  packageRoot: string;
};

function withFixture(run: (fixture: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-upgrade-"));
  try {
    const packageRoot = join(root, "package");
    const templateDir = join(packageRoot, "templates", "skills", "docbridge");
    mkdirSync(join(templateDir, "references"), { recursive: true });
    writeFileSync(join(templateDir, "SKILL.md"), "# DocBridge skill\n", "utf8");
    writeFileSync(join(templateDir, "references", "checks.md"), "# Checks\n", "utf8");

    const projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    run({ projectRoot, packageRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function installTemplate(fixture: Fixture, destination: string): string {
  const target = join(fixture.projectRoot, destination, "docbridge");
  mkdirSync(target, { recursive: true });
  cpSync(join(fixture.packageRoot, "templates", "skills", "docbridge"), target, {
    recursive: true,
  });
  return target;
}

function options(overrides: Partial<UpgradeOptions> = {}): UpgradeOptions {
  return {
    root: ".",
    agentTarget: undefined,
    check: false,
    dryRun: false,
    yes: false,
    force: false,
    ...overrides,
  };
}

function plan(
  fixture: Fixture,
  overrides: Partial<UpgradeOptions> = {},
  latest?: LatestVersionLookup,
) {
  return planUpgrade({
    projectRoot: fixture.projectRoot,
    packageRoot: fixture.packageRoot,
    currentVersion: "0.8.0",
    latest: latest ?? { status: "ok", latest: "0.8.0", source: "cache" },
    guidance: detectUpgradeGuidance({
      packageRoot: fixture.packageRoot,
      projectRoot: fixture.projectRoot,
      env: {},
    }),
    discovery: discoverRepository(fixture.projectRoot),
    options: options(overrides),
  });
}

test("reportCliVersion reports an outdated binary", () => {
  expect(reportCliVersion("0.8.0", { status: "ok", latest: "0.9.0", source: "network" })).toEqual({
    current: "0.8.0",
    latest: "0.9.0",
    status: "outdated",
  });
});

test("reportCliVersion reports an up-to-date binary", () => {
  expect(reportCliVersion("0.8.0", { status: "ok", latest: "0.8.0", source: "cache" }).status).toBe(
    "up-to-date",
  );
});

test("reportCliVersion reports a binary ahead of the registry", () => {
  expect(reportCliVersion("0.9.0", { status: "ok", latest: "0.8.0", source: "cache" }).status).toBe(
    "ahead",
  );
});

test("reportCliVersion reports unknown when the lookup failed", () => {
  expect(reportCliVersion("0.8.0", { status: "unavailable", source: "network" })).toEqual({
    current: "0.8.0",
    latest: undefined,
    status: "unknown",
  });
});

test("resolveUpgradeAgentTarget prefers the explicit target", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    expect(resolveUpgradeAgentTarget(discoverRepository(fixture.projectRoot), "both")).toBe("both");
  });
});

test("resolveUpgradeAgentTarget falls back to the detected agent directories", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    expect(resolveUpgradeAgentTarget(discoverRepository(fixture.projectRoot), undefined)).toBe(
      "claude",
    );
  });
});

test("inspectManagedSkill reports an absent skill", () => {
  withFixture((fixture) => {
    expect(
      inspectManagedSkill({
        projectRoot: fixture.projectRoot,
        packageRoot: fixture.packageRoot,
        destination: ".claude/skills",
        templateAvailable: true,
      }).state,
    ).toBe("absent");
  });
});

test("inspectManagedSkill reports an untouched copy as up to date", () => {
  withFixture((fixture) => {
    installTemplate(fixture, ".claude/skills");
    expect(
      inspectManagedSkill({
        projectRoot: fixture.projectRoot,
        packageRoot: fixture.packageRoot,
        destination: ".claude/skills",
        templateAvailable: true,
      }),
    ).toEqual({
      destination: ".claude/skills",
      path: ".claude/skills/docbridge",
      state: "up-to-date",
      modifiedFiles: [],
      missingFiles: [],
      extraFiles: [],
    });
  });
});

test("inspectManagedSkill names locally modified, missing, and extra files", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture, ".claude/skills");
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    rmSync(join(installed, "references", "checks.md"));
    writeFileSync(join(installed, "local-notes.md"), "team notes\n", "utf8");

    const report = inspectManagedSkill({
      projectRoot: fixture.projectRoot,
      packageRoot: fixture.packageRoot,
      destination: ".claude/skills",
      templateAvailable: true,
    });

    expect(report.state).toBe("modified");
    expect(report.modifiedFiles).toEqual(["SKILL.md"]);
    expect(report.missingFiles).toEqual(["references/checks.md"]);
    expect(report.extraFiles).toEqual(["local-notes.md"]);
  });
});

test("inspectManagedSkill reports a symlinked skill directory", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    symlinkSync(
      join(fixture.packageRoot, "templates", "skills", "docbridge"),
      join(fixture.projectRoot, ".claude/skills/docbridge"),
    );

    expect(
      inspectManagedSkill({
        projectRoot: fixture.projectRoot,
        packageRoot: fixture.packageRoot,
        destination: ".claude/skills",
        templateAvailable: true,
      }).state,
    ).toBe("symlink");
  });
});

test("inspectManagedSkill reports a missing packaged template", () => {
  withFixture((fixture) => {
    installTemplate(fixture, ".claude/skills");
    expect(
      inspectManagedSkill({
        projectRoot: fixture.projectRoot,
        packageRoot: fixture.packageRoot,
        destination: ".claude/skills",
        templateAvailable: false,
      }).state,
    ).toBe("template-missing");
  });
});

test("inspectLegacySkills lists only the known legacy names", () => {
  withFixture((fixture) => {
    for (const name of [...LEGACY_NAMES, "docbridge-custom", "unrelated"]) {
      mkdirSync(join(fixture.projectRoot, ".claude/skills", name), { recursive: true });
    }

    expect(
      inspectLegacySkills(fixture.projectRoot, ".claude/skills").map((entry) => entry.path),
    ).toEqual(LEGACY_NAMES.map((name) => `.claude/skills/${name}`));
  });
});

test("inspectLegacySkills distinguishes a symlinked legacy skill", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    symlinkSync(
      join(fixture.packageRoot, "templates", "skills", "docbridge"),
      join(fixture.projectRoot, ".claude/skills/docbridge-adopt"),
    );

    expect(inspectLegacySkills(fixture.projectRoot, ".claude/skills")).toEqual([
      { path: ".claude/skills/docbridge-adopt", kind: "symlink" },
    ]);
  });
});

test("planUpgrade in check mode plans no operations at all", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-adopt"), { recursive: true });

    const result = plan(fixture, { check: true, force: true, agentTarget: "claude" });

    expect(result.mode).toBe("check");
    expect(result.operations).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.legacySkills).toHaveLength(1);
  });
});

test("planUpgrade installs an absent managed skill without --force", () => {
  withFixture((fixture) => {
    const result = plan(fixture, { agentTarget: "claude" });

    expect(result.operations).toEqual([
      {
        action: "create",
        path: ".claude/skills/docbridge",
        reason: "Install the managed docbridge skill.",
      },
    ]);
    expect(result.requiresConfirmation).toBe(false);
  });
});

test("planUpgrade preserves an existing skill and reports it as pending without --force", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture, ".claude/skills");
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-link"), { recursive: true });

    const result = plan(fixture, { agentTarget: "claude" });

    expect(result.operations).toEqual([]);
    expect(result.pending).toEqual([
      ".claude/skills/docbridge is locally modified and was preserved. Re-run with --force to replace it with the packaged template.",
      ".claude/skills/docbridge-link is a leftover directory from the previous five-skill layout. Re-run with --force to remove it after reviewing local edits.",
    ]);
  });
});

test("planUpgrade with --force overwrites the skill and removes ordinary legacy directories", () => {
  withFixture((fixture) => {
    installTemplate(fixture, ".claude/skills");
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-link"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-custom"), { recursive: true });

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.operations.map((operation) => [operation.action, operation.path])).toEqual([
      ["overwrite", ".claude/skills/docbridge"],
      ["remove", ".claude/skills/docbridge-link"],
    ]);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.pending).toEqual([]);
  });
});

test("planUpgrade with --force never plans anything for a symlink", () => {
  withFixture((fixture) => {
    const skills = join(fixture.projectRoot, ".claude/skills");
    mkdirSync(skills, { recursive: true });
    const template = join(fixture.packageRoot, "templates", "skills", "docbridge");
    symlinkSync(template, join(skills, "docbridge"));
    symlinkSync(template, join(skills, "docbridge-adopt"));

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.operations).toEqual([]);
    expect(result.messages).toContain(
      "Skill directory .claude/skills/docbridge is a symlink and was left in place.",
    );
    expect(result.messages).toContain(
      "Skill directory .claude/skills/docbridge-adopt is a symlink and was left in place.",
    );
  });
});

test("planUpgrade with --dry-run renders would-* actions and needs no confirmation", () => {
  withFixture((fixture) => {
    installTemplate(fixture, ".claude/skills");
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-sync"), { recursive: true });

    const result = plan(fixture, { agentTarget: "claude", force: true, dryRun: true });

    expect(result.operations.map((operation) => operation.action)).toEqual([
      "would-overwrite",
      "would-remove",
    ]);
    expect(result.requiresConfirmation).toBe(false);
  });
});

test("planUpgrade with --yes needs no confirmation", () => {
  withFixture((fixture) => {
    installTemplate(fixture, ".claude/skills");
    expect(
      plan(fixture, { agentTarget: "claude", force: true, yes: true }).requiresConfirmation,
    ).toBe(false);
  });
});

test("planUpgrade covers both destinations for --agent-target both", () => {
  withFixture((fixture) => {
    const result = plan(fixture, { agentTarget: "both" });

    expect(result.managedSkills.map((report) => report.path)).toEqual([
      ".agents/skills/docbridge",
      ".claude/skills/docbridge",
    ]);
  });
});

test("planUpgrade inspects nothing for --agent-target none", () => {
  withFixture((fixture) => {
    const result = plan(fixture, { agentTarget: "none" });

    expect(result.managedSkills).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.messages[0]).toContain("No agent skill directory was selected");
  });
});

test("planUpgrade explains that DocBridge does not upgrade itself when outdated", () => {
  withFixture((fixture) => {
    const result = plan(
      fixture,
      { agentTarget: "none" },
      {
        status: "ok",
        latest: "0.9.0",
        source: "network",
      },
    );

    expect(result.cli.status).toBe("outdated");
    expect(result.messages.join("\n")).toContain("DocBridge does not upgrade itself");
    expect(result.messages.join("\n")).toContain("npm install --save-dev docbridge@latest");
    expect(result.nextSteps).toContain(
      "Upgrade the CLI with the command above, then re-run `docbridge upgrade`.",
    );
  });
});

test("planUpgrade reports an unavailable registry without failing", () => {
  withFixture((fixture) => {
    const result = plan(
      fixture,
      { agentTarget: "none" },
      { status: "unavailable", source: "network" },
    );

    expect(result.cli).toEqual({ current: "0.8.0", latest: undefined, status: "unknown" });
    expect(result.exitCode).toBe(0);
    expect(result.messages.join("\n")).toContain("could not be determined");
  });
});

test("formatUpgradePlan renders version, assets, operations, and pending sections", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture, ".claude/skills");
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-review"), { recursive: true });

    const output = formatUpgradePlan(plan(fixture, { agentTarget: "claude" }));

    expect(output).toContain("DocBridge 0.8.0 (latest stable: 0.8.0)");
    expect(output).toContain("Status: up-to-date");
    expect(output).toContain("Upgrade command (");
    expect(output).toContain("Managed skills:");
    expect(output).toContain("- .claude/skills/docbridge: modified");
    expect(output).toContain("    changed: SKILL.md");
    expect(output).toContain("Legacy skills:");
    expect(output).toContain("- .claude/skills/docbridge-review (directory)");
    expect(output).toContain("Pending migration:");
    expect(output.endsWith("\n")).toBe(true);
  });
});

test("formatUpgradePlan renders an unknown latest version", () => {
  withFixture((fixture) => {
    const output = formatUpgradePlan(
      plan(fixture, { agentTarget: "none" }, { status: "unavailable", source: "network" }),
    );

    expect(output).toContain("(latest stable: unknown)");
    expect(output).toContain("Status: unknown");
  });
});

test("inspectLegacySkills reports a legacy name that is an ordinary file", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(join(fixture.projectRoot, ".claude/skills/docbridge-adopt"), "notes\n", "utf8");

    expect(inspectLegacySkills(fixture.projectRoot, ".claude/skills")).toEqual([
      { path: ".claude/skills/docbridge-adopt", kind: "non-directory" },
    ]);
  });
});

test("planUpgrade with --force never removes a legacy name that is an ordinary file", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(join(fixture.projectRoot, ".claude/skills/docbridge-adopt"), "notes\n", "utf8");

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.operations.map((operation) => operation.path)).not.toContain(
      ".claude/skills/docbridge-adopt",
    );
    expect(result.messages.join("\n")).toContain(
      ".claude/skills/docbridge-adopt exists but is not a directory",
    );
  });
});

test("planUpgrade reports a managed skill under a symlinked destination directory", () => {
  withFixture((fixture) => {
    const shared = join(fixture.projectRoot, "..", "shared-skills");
    mkdirSync(join(shared, "docbridge"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.managedSkills[0]?.state).toBe("symlinked-parent");
    expect(result.operations).toEqual([]);
    expect(result.messages.join("\n")).toContain("sits under a symlinked directory");
  });
});

test("planUpgrade with --force never plans work through a symlinked destination directory", () => {
  withFixture((fixture) => {
    const shared = join(fixture.projectRoot, "..", "shared-skills");
    mkdirSync(join(shared, "docbridge-link"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.operations).toEqual([]);
    expect(result.legacySkills).toEqual([
      { path: ".claude/skills/docbridge-link", kind: "symlinked-parent" },
    ]);
  });
});

test("planUpgrade reports a managed skill path that is an ordinary file", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(join(fixture.projectRoot, ".claude/skills/docbridge"), "notes\n", "utf8");

    const result = plan(fixture, { agentTarget: "claude", force: true });

    expect(result.managedSkills[0]?.state).toBe("non-directory");
    expect(result.operations).toEqual([]);
  });
});
