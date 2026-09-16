import { expect, test } from "bun:test";
import {
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

import {
  applySkillOperation,
  classifyManagedPath,
  compareSkillTree,
  isSymlink,
  listSkillFiles,
  unmanageablePathMessage,
} from "./skill-assets";

type Fixture = {
  root: string;
  projectRoot: string;
  packageRoot: string;
  templateDir: string;
};

function withFixture(body: (fixture: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-skill-assets-"));
  try {
    const packageRoot = join(root, "package");
    const templateDir = join(packageRoot, "templates", "skills", "docbridge");
    mkdirSync(join(templateDir, "references"), { recursive: true });
    writeFileSync(join(templateDir, "SKILL.md"), "# Skill\n", "utf8");
    writeFileSync(join(templateDir, "references", "checks.md"), "# Checks\n", "utf8");

    const projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    body({ root, projectRoot, packageRoot, templateDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("listSkillFiles walks nested directories in sorted order", () => {
  withFixture((fixture) => {
    expect(listSkillFiles(fixture.templateDir)).toEqual(["SKILL.md", "references/checks.md"]);
  });
});

test("listSkillFiles returns nothing for a missing directory", () => {
  withFixture((fixture) => {
    expect(listSkillFiles(join(fixture.root, "absent"))).toEqual([]);
  });
});

test("compareSkillTree reports no drift for an identical copy", () => {
  withFixture((fixture) => {
    const installed = join(fixture.projectRoot, "installed");
    mkdirSync(join(installed, "references"), { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), "# Skill\n", "utf8");
    writeFileSync(join(installed, "references", "checks.md"), "# Checks\n", "utf8");

    expect(compareSkillTree(installed, fixture.templateDir)).toEqual({
      modified: [],
      missing: [],
      extra: [],
    });
  });
});

test("compareSkillTree separates changed, missing, and extra files", () => {
  withFixture((fixture) => {
    const installed = join(fixture.projectRoot, "installed");
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), "# Edited\n", "utf8");
    writeFileSync(join(installed, "notes.md"), "local\n", "utf8");

    expect(compareSkillTree(installed, fixture.templateDir)).toEqual({
      modified: ["SKILL.md"],
      missing: ["references/checks.md"],
      extra: ["notes.md"],
    });
  });
});

test("compareSkillTree treats an absent installation as fully missing", () => {
  withFixture((fixture) => {
    expect(compareSkillTree(join(fixture.root, "absent"), fixture.templateDir)).toEqual({
      modified: [],
      missing: ["SKILL.md", "references/checks.md"],
      extra: [],
    });
  });
});

test("isSymlink distinguishes links from directories and absent paths", () => {
  withFixture((fixture) => {
    const link = join(fixture.projectRoot, "link");
    symlinkSync(fixture.templateDir, link);

    expect(isSymlink(link)).toBe(true);
    expect(isSymlink(fixture.templateDir)).toBe(false);
    expect(isSymlink(join(fixture.root, "absent"))).toBe(false);
  });
});

test("applySkillOperation copies the template for a create action", () => {
  withFixture((fixture) => {
    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "create",
      path: ".claude/skills/docbridge",
    });

    expect(
      readFileSync(join(fixture.projectRoot, ".claude/skills/docbridge/SKILL.md"), "utf8"),
    ).toBe("# Skill\n");
    expect(
      readFileSync(
        join(fixture.projectRoot, ".claude/skills/docbridge/references/checks.md"),
        "utf8",
      ),
    ).toBe("# Checks\n");
  });
});

test("applySkillOperation replaces local edits for an overwrite action", () => {
  withFixture((fixture) => {
    const installed = join(fixture.projectRoot, ".claude/skills/docbridge");
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), "# Edited\n", "utf8");

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "overwrite",
      path: ".claude/skills/docbridge",
    });

    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("# Skill\n");
  });
});

test("applySkillOperation removes an ordinary directory", () => {
  withFixture((fixture) => {
    const legacy = join(fixture.projectRoot, ".claude/skills/docbridge-adopt");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "SKILL.md"), "# Legacy\n", "utf8");

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "remove",
      path: ".claude/skills/docbridge-adopt",
    });

    expect(existsSync(legacy)).toBe(false);
  });
});

test.each(["create", "overwrite", "remove"] as const)(
  "applySkillOperation leaves a symlink untouched for a %s action",
  (action) => {
    withFixture((fixture) => {
      const skills = join(fixture.projectRoot, ".claude/skills");
      mkdirSync(skills, { recursive: true });
      const link = join(skills, "docbridge");
      symlinkSync(fixture.templateDir, link);
      writeFileSync(join(fixture.templateDir, "SKILL.md"), "# Shared source\n", "utf8");

      applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
        action,
        path: ".claude/skills/docbridge",
      });

      expect(isSymlink(link)).toBe(true);
      expect(readFileSync(join(fixture.templateDir, "SKILL.md"), "utf8")).toBe("# Shared source\n");
    });
  },
);

test.each(["skip", "would-create", "would-overwrite", "would-remove"] as const)(
  "applySkillOperation writes nothing for the %s action",
  (action) => {
    withFixture((fixture) => {
      applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
        action,
        path: ".claude/skills/docbridge",
      });

      expect(existsSync(join(fixture.projectRoot, ".claude/skills/docbridge"))).toBe(false);
    });
  },
);

test("applySkillOperation removing an absent path is a no-op", () => {
  withFixture((fixture) => {
    expect(() => {
      applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
        action: "remove",
        path: ".claude/skills/docbridge-adopt",
      });
    }).not.toThrow();
  });
});

test("classifyManagedPath reports an ordinary directory", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills/docbridge"), { recursive: true });

    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe("directory");
  });
});

test("classifyManagedPath reports an absent destination", () => {
  withFixture((fixture) => {
    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe("absent");
  });
});

test("classifyManagedPath reports a symlinked destination", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    symlinkSync(fixture.templateDir, join(fixture.projectRoot, ".claude/skills/docbridge"));

    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe("symlink");
  });
});

test("classifyManagedPath reports a symlinked ancestor rather than the link target", () => {
  withFixture((fixture) => {
    const shared = join(fixture.root, "shared-skills");
    mkdirSync(join(shared, "docbridge"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));

    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe(
      "symlinked-parent",
    );
  });
});

test("classifyManagedPath reports a non-directory destination", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(
      join(fixture.projectRoot, ".claude/skills/docbridge"),
      "not a directory\n",
      "utf8",
    );

    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe(
      "non-directory",
    );
  });
});

test("classifyManagedPath reports a parent that is not a directory", () => {
  withFixture((fixture) => {
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    writeFileSync(join(fixture.projectRoot, ".claude/skills"), "not a directory\n", "utf8");

    expect(classifyManagedPath(fixture.projectRoot, ".claude/skills/docbridge")).toBe(
      "blocked-parent",
    );
  });
});

test.each(["create", "overwrite", "remove"] as const)(
  "applySkillOperation refuses to %s through a symlinked ancestor",
  (action) => {
    withFixture((fixture) => {
      const shared = join(fixture.root, "shared-skills");
      mkdirSync(join(shared, "docbridge"), { recursive: true });
      writeFileSync(join(shared, "docbridge", "SKILL.md"), "# Shared\n", "utf8");
      mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
      symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));

      applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
        action,
        path: ".claude/skills/docbridge",
      });

      expect(existsSync(join(shared, "docbridge"))).toBe(true);
      expect(readFileSync(join(shared, "docbridge", "SKILL.md"), "utf8")).toBe("# Shared\n");
    });
  },
);

test("applySkillOperation never removes a legacy directory through a symlinked ancestor", () => {
  withFixture((fixture) => {
    const shared = join(fixture.root, "shared-skills");
    mkdirSync(join(shared, "docbridge-adopt"), { recursive: true });
    mkdirSync(join(fixture.projectRoot, ".claude"), { recursive: true });
    symlinkSync(shared, join(fixture.projectRoot, ".claude/skills"));

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "remove",
      path: ".claude/skills/docbridge-adopt",
    });

    expect(existsSync(join(shared, "docbridge-adopt"))).toBe(true);
  });
});

test("applySkillOperation never removes an ordinary file", () => {
  withFixture((fixture) => {
    const legacy = join(fixture.projectRoot, ".claude/skills/docbridge-adopt");
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(legacy, "not a directory\n", "utf8");

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "remove",
      path: ".claude/skills/docbridge-adopt",
    });

    expect(readFileSync(legacy, "utf8")).toBe("not a directory\n");
  });
});

test("applySkillOperation overwrite reproduces the packaged tree exactly", () => {
  withFixture((fixture) => {
    const installed = join(fixture.projectRoot, ".claude/skills/docbridge");
    mkdirSync(join(installed, "local"), { recursive: true });
    writeFileSync(join(installed, "SKILL.md"), "# Edited\n", "utf8");
    writeFileSync(join(installed, "local-notes.md"), "team notes\n", "utf8");
    writeFileSync(join(installed, "local", "extra.md"), "more\n", "utf8");

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "overwrite",
      path: ".claude/skills/docbridge",
    });

    expect(listSkillFiles(installed)).toEqual(listSkillFiles(fixture.templateDir));
    expect(compareSkillTree(installed, fixture.templateDir)).toEqual({
      modified: [],
      missing: [],
      extra: [],
    });
  });
});

test("applySkillOperation leaves a non-directory destination alone on overwrite", () => {
  withFixture((fixture) => {
    const destination = join(fixture.projectRoot, ".claude/skills/docbridge");
    mkdirSync(join(fixture.projectRoot, ".claude/skills"), { recursive: true });
    writeFileSync(destination, "not a directory\n", "utf8");

    applySkillOperation(fixture.projectRoot, fixture.packageRoot, {
      action: "overwrite",
      path: ".claude/skills/docbridge",
    });

    expect(readFileSync(destination, "utf8")).toBe("not a directory\n");
  });
});

test("unmanageablePathMessage keeps the established wording for a symlink", () => {
  expect(unmanageablePathMessage(".claude/skills/docbridge", "symlink")).toBe(
    "Skill directory .claude/skills/docbridge is a symlink and was left in place.",
  );
});

test("unmanageablePathMessage explains a symlinked ancestor", () => {
  expect(unmanageablePathMessage(".claude/skills/docbridge", "symlinked-parent")).toContain(
    "would leave the project root",
  );
});
