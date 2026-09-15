import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAiAssets } from "./check-ai-assets";

function write(root: string, path: string, content: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

function skill(name: string): string {
  return `---\nname: ${name}\n---\n\n# ${name}\n`;
}

function withAiAssets(callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-check-ai-assets-"));

  write(root, ".oxfmtrc.json", `${JSON.stringify({ ignorePatterns: ["dist/**"] }, null, 2)}\n`);
  write(root, ".oxlintrc.json", `${JSON.stringify({ ignorePatterns: ["dist/**"] }, null, 2)}\n`);
  write(root, ".rumdl.toml", '[global]\ndisable = ["MD013"]\nexclude = ["dist/**"]\n');

  write(root, "templates/skills/docbridge/SKILL.md", skill("docbridge"));
  for (const name of ["git-workflow", "tdd"]) {
    write(root, `.agents/skills/${name}/SKILL.md`, skill(name));
    write(root, `.claude/skills/${name}/SKILL.md`, skill(name));
  }
  write(root, ".agents/skills/tdd/references/bun-test.md", "# Bun test\n");
  write(root, ".claude/skills/tdd/references/bun-test.md", "# Bun test\n");
  write(root, ".agents/skills/concise-writing/SKILL.md", skill("concise-writing"));

  symlinkSync("../../templates/skills/docbridge", join(root, ".agents/skills/docbridge"));
  symlinkSync("../../templates/skills/docbridge", join(root, ".claude/skills/docbridge"));
  symlinkSync("../../.agents/skills/concise-writing", join(root, ".claude/skills/concise-writing"));

  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checkAiAssets accepts skill trees that agree", () => {
  withAiAssets((root) => {
    expect(checkAiAssets(root)).toEqual([]);
  });
});

test("checkAiAssets reports a duplicated skill whose copies differ", () => {
  withAiAssets((root) => {
    write(root, ".claude/skills/tdd/references/bun-test.md", "# Bun test\n\nEdited.\n");

    expect(checkAiAssets(root)).toEqual([
      "tdd/references/bun-test.md differs between .agents/skills/ and .claude/skills/.",
    ]);
  });
});

test("checkAiAssets reports a file that exists in only one copy of a duplicated skill", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, ".claude/skills/tdd/references/bun-test.md"));

    expect(checkAiAssets(root)).toEqual([
      "tdd/references/bun-test.md is missing from .claude/skills/.",
    ]);
  });
});

test("checkAiAssets reports a skill that exists in only one tree", () => {
  withAiAssets((root) => {
    write(root, ".claude/skills/grill-me/SKILL.md", skill("grill-me"));

    expect(checkAiAssets(root)).toEqual(["grill-me is missing from .agents/skills/."]);
  });
});

test("checkAiAssets reports a shared skill that stopped resolving to its target", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, ".claude/skills/docbridge"));
    write(root, ".claude/skills/docbridge/SKILL.md", skill("docbridge"));

    expect(checkAiAssets(root)).toEqual([
      ".claude/skills/docbridge must be a symlink to templates/skills/docbridge.",
    ]);
  });
});

test("checkAiAssets reports a broken shared skill symlink", () => {
  withAiAssets((root) => {
    rmSync(join(root, "templates/skills/docbridge"), { recursive: true, force: true });

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/docbridge must be a symlink to templates/skills/docbridge.",
      ".claude/skills/docbridge must be a symlink to templates/skills/docbridge.",
    ]);
  });
});

test("checkAiAssets reports a skill tree excluded from formatting", () => {
  withAiAssets((root) => {
    write(
      root,
      ".oxfmtrc.json",
      `${JSON.stringify({ ignorePatterns: ["dist/**", ".claude/skills/**"] }, null, 2)}\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      '.oxfmtrc.json excludes ".claude/skills/**"; both skill trees must stay formatted and linted.',
    ]);
  });
});

test("checkAiAssets reports a skill tree excluded from linting", () => {
  withAiAssets((root) => {
    write(
      root,
      ".rumdl.toml",
      '[global]\ndisable = ["MD013"]\nexclude = [\n  ".agents/skills/**",\n]\n',
    );

    expect(checkAiAssets(root)).toEqual([
      '.rumdl.toml excludes ".agents/skills/**"; both skill trees must stay formatted and linted.',
    ]);
  });
});

test("checkAiAssets reports every configuration that excludes a skill tree", () => {
  withAiAssets((root) => {
    write(
      root,
      ".oxlintrc.json",
      `${JSON.stringify({ ignorePatterns: [".claude/skills/**"] }, null, 2)}\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      '.oxlintrc.json excludes ".claude/skills/**"; both skill trees must stay formatted and linted.',
    ]);
  });
});

test("just verify and CI include the AI asset drift check", () => {
  const root = join(import.meta.dir, "..");
  const justfile = readFileSync(join(root, "justfile"), "utf8");
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

  expect(justfile).toMatch(/^verify: .*\bcheck-ai-assets\b/m);
  expect(justfile).toContain("\ncheck-ai-assets:\n    bun run scripts/check-ai-assets.ts\n");
  expect(workflow).toContain("nix develop -c just check-ai-assets");
});

test("the repository AI assets pass the drift check", () => {
  expect(checkAiAssets(join(import.meta.dir, ".."))).toEqual([]);
});
