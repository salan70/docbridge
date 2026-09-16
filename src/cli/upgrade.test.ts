import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LatestVersionLookup } from "../setup/registry";
import { run } from "./index";
import type { InitPrompts, InitRuntime } from "./init";
import { capture } from "./test-support";
import { parseUpgradeOptions } from "./upgrade";

type Fixture = {
  projectRoot: string;
  packageRoot: string;
};

function withFixture(body: (fixture: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-upgrade-cli-"));
  try {
    const templateDir = join(root, "package", "templates", "skills", "docbridge");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "SKILL.md"), "# DocBridge skill\n", "utf8");

    const projectRoot = join(root, "project");
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    body({ projectRoot, packageRoot: join(root, "package") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function installTemplate(fixture: Fixture): string {
  const target = join(fixture.projectRoot, ".claude/skills/docbridge");
  mkdirSync(target, { recursive: true });
  cpSync(join(fixture.packageRoot, "templates", "skills", "docbridge"), target, {
    recursive: true,
  });
  return target;
}

function prompts(overrides: Partial<InitPrompts> = {}): InitPrompts {
  return {
    isInteractive: false,
    confirm: () => false,
    select: (_message, _choices, defaultChoice) => defaultChoice,
    ...overrides,
  };
}

function runtime(fixture: Fixture, promptOverrides: Partial<InitPrompts> = {}): InitRuntime {
  return { prompts: prompts(promptOverrides), packageRoot: fixture.packageRoot };
}

const upToDate: LatestVersionLookup = { status: "ok", latest: "0.0.1", source: "cache" };

test("parseUpgradeOptions defaults every flag to off", () => {
  expect(parseUpgradeOptions([])).toEqual({
    root: ".",
    agentTarget: undefined,
    check: false,
    dryRun: false,
    yes: false,
    force: false,
  });
});

test("parseUpgradeOptions reads every supported flag", () => {
  expect(
    parseUpgradeOptions([
      "--root",
      "somewhere",
      "--agent-target",
      "both",
      "--check",
      "--dry-run",
      "--yes",
      "--force",
    ]),
  ).toEqual({
    root: "somewhere",
    agentTarget: "both",
    check: true,
    dryRun: true,
    yes: true,
    force: true,
  });
});

test.each([
  [["--root"], "--root requires a path."],
  [["--agent-target"], "--agent-target requires a value."],
  [["--agent-target", "emacs"], "Unknown agent target: emacs"],
  [["--nope"], "Unknown option: --nope"],
  [["stray"], "Unexpected argument: stray"],
])("parseUpgradeOptions rejects %p", (args, message) => {
  expect(() => parseUpgradeOptions(args)).toThrow(message);
});

test("upgrade --check reports state without writing anything", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-adopt"), { recursive: true });
    const c = capture();

    const code = run(
      ["upgrade", "--check", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(c.out).toContain("Status: ahead");
    expect(c.out).toContain("- .claude/skills/docbridge: absent");
    expect(c.out).toContain("- .claude/skills/docbridge-adopt (directory)");
    expect(c.out).not.toContain("Operations:");
    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge"))).toBe(false);
    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge-adopt"))).toBe(true);
    expect(c.err).toBe("");
  });
});

test("upgrade --check stays read-only even with --force", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-sync"), { recursive: true });

    run(
      ["upgrade", "--check", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge-sync"))).toBe(true);
  });
});

test("upgrade --dry-run prints the plan without writing files", () => {
  withFixture((fixture) => {
    const c = capture();

    const code = run(
      ["upgrade", "--dry-run", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(c.out).toContain("- would create .claude/skills/docbridge");
    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge"))).toBe(false);
  });
});

test("upgrade installs an absent managed skill without prompting", () => {
  withFixture((fixture) => {
    const c = capture();

    const code = run(["upgrade", "--root", fixture.projectRoot], c.io, runtime(fixture), {
      latest: upToDate,
    });

    expect(code).toBe(0);
    expect(
      readFileSync(join(fixture.projectRoot, ".claude/skills/docbridge/SKILL.md"), "utf8"),
    ).toBe("# DocBridge skill\n");
  });
});

test("upgrade without --force preserves a locally modified skill", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    const c = capture();

    const code = run(["upgrade", "--root", fixture.projectRoot], c.io, runtime(fixture), {
      latest: upToDate,
    });

    expect(code).toBe(0);
    expect(c.out).toContain("Pending migration:");
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# Locally edited\n");
  });
});

test("upgrade --force --yes replaces the skill and removes legacy directories", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-review"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge-custom"), { recursive: true });

    const code = run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# DocBridge skill\n");
    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge-review"))).toBe(false);
    expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge-custom"))).toBe(true);
  });
});

test("upgrade --force never removes a symlinked legacy skill", () => {
  withFixture((fixture) => {
    const skills = join(fixture.projectRoot, ".claude/skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(
      join(fixture.packageRoot, "templates", "skills", "docbridge"),
      join(skills, "docbridge-adopt"),
    );

    run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(existsSync(join(skills, "docbridge-adopt"))).toBe(true);
  });
});

test("upgrade --force leaves a symlinked managed skill untouched", () => {
  withFixture((fixture) => {
    const skills = join(fixture.projectRoot, ".claude/skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(
      join(fixture.packageRoot, "templates", "skills", "docbridge"),
      join(skills, "docbridge"),
    );
    const c = capture();

    run(["upgrade", "--force", "--yes", "--root", fixture.projectRoot], c.io, runtime(fixture), {
      latest: upToDate,
    });

    expect(c.out).toContain("is a symlink and was left in place.");
    expect(
      readFileSync(join(fixture.packageRoot, "templates/skills/docbridge/SKILL.md"), "utf8"),
    ).toBe("# DocBridge skill\n");
  });
});

test("upgrade --force refuses destructive work non-interactively without --yes", () => {
  withFixture((fixture) => {
    installTemplate(fixture);
    const c = capture();

    const code = run(
      ["upgrade", "--force", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture),
      {
        latest: upToDate,
      },
    );

    expect(code).toBe(1);
    expect(c.err).toContain("requires confirmation");
    expect(c.err).toContain("docbridge upgrade --force --yes");
  });
});

test("upgrade --force applies nothing when an interactive answer declines", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");
    const c = capture();

    const code = run(
      ["upgrade", "--force", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture, { isInteractive: true, confirm: () => false }),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(c.out).toContain("No changes were applied.");
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# Locally edited\n");
  });
});

test("upgrade --force applies the plan when an interactive answer accepts", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "SKILL.md"), "# Locally edited\n", "utf8");

    run(
      ["upgrade", "--force", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture, { isInteractive: true, confirm: () => true }),
      { latest: upToDate },
    );

    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# DocBridge skill\n");
  });
});

test("upgrade never modifies docbridge.config.json or unrelated project files", () => {
  withFixture((fixture) => {
    const configPath = join(fixture.projectRoot, "docbridge.config.json");
    writeFileSync(configPath, '{"include":{"code":{},"docs":[]}}\n', "utf8");
    const otherPath = join(fixture.projectRoot, ".claude/settings.json");
    writeFileSync(otherPath, '{"hooks":{}}\n', "utf8");

    run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(readFileSync(configPath, "utf8")).toBe('{"include":{"code":{},"docs":[]}}\n');
    expect(readFileSync(otherPath, "utf8")).toBe('{"hooks":{}}\n');
  });
});

test("upgrade reports an unresolvable root as a CLI error", () => {
  const c = capture();

  const code = run(["upgrade", "--root", join(tmpdir(), "docbridge-missing-root")], c.io, {
    prompts: prompts(),
  });

  expect(code).toBe(1);
  expect(c.err).toContain("Root path does not exist");
});

test("upgrade tolerates a missing registry answer", () => {
  withFixture((fixture) => {
    const c = capture();

    const code = run(["upgrade", "--check", "--root", fixture.projectRoot], c.io, runtime(fixture));

    expect(code).toBe(0);
    expect(c.out).toContain("Status: unknown");
    expect(c.out).toContain("(latest stable: unknown)");
  });
});

test("upgrade --force --yes never deletes through a symlinked skills directory", () => {
  withFixture((fixture) => {
    const shared = join(fixture.projectRoot, "..", "shared-skills");
    mkdirSync(join(shared, "docbridge-adopt"), { recursive: true });
    writeFileSync(join(shared, "docbridge-adopt", "SKILL.md"), "# Shared\n", "utf8");
    symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));
    const c = capture();

    const code = run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(existsSync(join(shared, "docbridge-adopt"))).toBe(true);
    expect(c.out).toContain("sits under a symlinked directory");
    expect(c.out).not.toContain("Operations:");
  });
});

test("upgrade --force --yes removes local files the template no longer ships", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "local-notes.md"), "team notes\n", "utf8");

    const code = run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(existsSync(join(installed, "local-notes.md"))).toBe(false);
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# DocBridge skill\n");
  });
});

test("upgrade --check reports a clean skill after a forced migration", () => {
  withFixture((fixture) => {
    const installed = installTemplate(fixture);
    writeFileSync(join(installed, "local-notes.md"), "team notes\n", "utf8");
    run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      capture().io,
      runtime(fixture),
      { latest: upToDate },
    );

    const c = capture();
    run(["upgrade", "--check", "--root", fixture.projectRoot], c.io, runtime(fixture), {
      latest: upToDate,
    });

    expect(c.out).toContain("- .claude/skills/docbridge: up-to-date");
  });
});

test("upgrade --force --yes never removes a legacy name that is an ordinary file", () => {
  withFixture((fixture) => {
    const legacy = join(fixture.projectRoot, ".claude/skills/docbridge-adopt");
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(legacy, "not a directory\n", "utf8");
    const c = capture();

    const code = run(
      ["upgrade", "--force", "--yes", "--root", fixture.projectRoot],
      c.io,
      runtime(fixture),
      { latest: upToDate },
    );

    expect(code).toBe(0);
    expect(readFileSync(legacy, "utf8")).toBe("not a directory\n");
    expect(c.out).toContain("exists but is not a directory");
  });
});
