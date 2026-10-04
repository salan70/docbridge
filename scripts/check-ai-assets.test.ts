import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAiAssets } from "./check-ai-assets";

function write(root: string, path: string, content: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Use when a test needs the ${name} skill.\n---\n\n# ${name}\n`;
}

function withAiAssets(callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-check-ai-assets-"));

  write(root, "templates/skills/docbridge/SKILL.md", skill("docbridge"));
  mkdirSync(join(root, ".agents/skills"), { recursive: true });
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  symlinkSync("../../templates/skills/docbridge", join(root, ".agents/skills/docbridge"));
  symlinkSync("../../templates/skills/docbridge", join(root, ".claude/skills/docbridge"));
  for (const name of ["concise-writing", "tdd"]) {
    write(root, `.agents/skills/${name}/SKILL.md`, skill(name));
    symlinkSync(`../../.agents/skills/${name}`, join(root, `.claude/skills/${name}`));
  }

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

test("checkAiAssets reports a Claude skill copied instead of linked", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, ".claude/skills/tdd"));
    write(root, ".claude/skills/tdd/SKILL.md", skill("tdd"));

    expect(checkAiAssets(root)).toEqual([
      ".claude/skills/tdd must be a symlink that resolves to .agents/skills/tdd.",
    ]);
  });
});

test("checkAiAssets reports a skill that exists only in the Claude tree", () => {
  withAiAssets((root) => {
    write(root, ".claude/skills/grill-me/SKILL.md", skill("grill-me"));

    expect(checkAiAssets(root)).toEqual(["grill-me is missing from .agents/skills/."]);
  });
});

test("checkAiAssets reports a skill that exists only in the Codex tree", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/grill-me/SKILL.md", skill("grill-me"));

    expect(checkAiAssets(root)).toEqual(["grill-me is missing from .claude/skills/."]);
  });
});

test("checkAiAssets reports a Codex skill that links outside the Codex tree", () => {
  withAiAssets((root) => {
    rmSync(join(root, ".agents/skills/tdd"), { recursive: true, force: true });
    write(root, "outside/tdd/SKILL.md", skill("tdd"));
    symlinkSync("../../outside/tdd", join(root, ".agents/skills/tdd"));

    expect(checkAiAssets(root)).toEqual([".agents/skills/tdd must be a directory, not a symlink."]);
  });
});

test("checkAiAssets reports a Codex docbridge skill that is not the template", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, ".agents/skills/docbridge"));
    write(root, ".agents/skills/docbridge/SKILL.md", skill("docbridge"));

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/docbridge must be a symlink to templates/skills/docbridge.",
      ".claude/skills/docbridge must be a symlink that resolves to .agents/skills/docbridge.",
    ]);
  });
});

test("checkAiAssets reports broken skill symlinks", () => {
  withAiAssets((root) => {
    rmSync(join(root, "templates/skills/docbridge"), { recursive: true, force: true });

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/docbridge must be a symlink to templates/skills/docbridge.",
      ".claude/skills/docbridge must be a symlink that resolves to .agents/skills/docbridge.",
    ]);
  });
});

test("the repository AI assets pass the drift check", () => {
  expect(checkAiAssets(join(import.meta.dir, ".."))).toEqual([]);
});
