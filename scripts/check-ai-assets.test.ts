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

const SHARED_GUIDANCE = `# AGENTS.md

Shared guidance for every coding agent working in this repository.

## Commands

Use the repo-native recipes in \`justfile\` instead of ad-hoc shell invocations,
and run \`just verify\` before reporting completion.

- Branch from an up-to-date \`main\` and land every change through a pull request.
- Logic changes are test-first; use the \`tdd\` skill.
`;

const CLAUDE_GUIDANCE = `# CLAUDE.md

Claude Code guidance. The shared rules are imported below.

@AGENTS.md

## Commands

Claude Code auto-discovers project skills from the symlinks in \`.claude/skills/\`.
`;

function withAiAssets(callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-check-ai-assets-"));

  write(root, ".oxfmtrc.json", `${JSON.stringify({ ignorePatterns: ["dist/**"] }, null, 2)}\n`);
  write(root, ".oxlintrc.json", `${JSON.stringify({ ignorePatterns: ["dist/**"] }, null, 2)}\n`);
  write(root, ".rumdl.toml", '[global]\ndisable = ["MD013"]\nexclude = ["dist/**"]\n');

  write(root, "AGENTS.md", SHARED_GUIDANCE);
  write(root, "CLAUDE.md", CLAUDE_GUIDANCE);
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

test("checkAiAssets reports an exclusion glob that covers a skill tree", () => {
  withAiAssets((root) => {
    write(
      root,
      ".oxfmtrc.json",
      `${JSON.stringify({ ignorePatterns: [".claude/**"] }, null, 2)}\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      '.oxfmtrc.json excludes ".claude/**"; both skill trees must stay formatted and linted.',
    ]);
  });
});

test("checkAiAssets reports an exclusion that names a skill tree directory", () => {
  withAiAssets((root) => {
    write(root, ".rumdl.toml", '[global]\ndisable = ["MD013"]\nexclude = [".agents/skills"]\n');

    expect(checkAiAssets(root)).toEqual([
      '.rumdl.toml excludes ".agents/skills"; both skill trees must stay formatted and linted.',
    ]);
  });
});

test("checkAiAssets reports a skill directory without SKILL.md", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, ".agents/skills/tdd/SKILL.md"));
    write(root, ".agents/skills/tdd/README.md", "# tdd\n");

    expect(checkAiAssets(root)).toEqual([".agents/skills/tdd/SKILL.md is missing."]);
  });
});

test("checkAiAssets reports a SKILL.md that does not start with frontmatter", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/tdd/SKILL.md", "# tdd\n\n---\nname: tdd\n---\n");

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md must begin with YAML frontmatter between `---` lines.",
    ]);
  });
});

test("checkAiAssets reports SKILL.md frontmatter that is never closed", () => {
  withAiAssets((root) => {
    write(
      root,
      ".agents/skills/tdd/SKILL.md",
      "---\nname: tdd\ndescription: Test first.\n\n# tdd\n",
    );

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md must begin with YAML frontmatter between `---` lines.",
    ]);
  });
});

test("checkAiAssets reports SKILL.md frontmatter that is not a YAML mapping", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/tdd/SKILL.md", "---\n- tdd\n- Test first.\n---\n\n# tdd\n");

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md frontmatter must be a YAML mapping.",
    ]);
  });
});

test("checkAiAssets reports SKILL.md frontmatter that is not valid YAML", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/tdd/SKILL.md", "---\nname: [tdd\n---\n\n# tdd\n");

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md frontmatter must be a YAML mapping.",
    ]);
  });
});

test("checkAiAssets reports SKILL.md frontmatter that repeats a key", () => {
  withAiAssets((root) => {
    write(
      root,
      ".agents/skills/tdd/SKILL.md",
      "---\nname: tdd\ndescription: [invalid, value]\ndescription: Test first.\n---\n\n# tdd\n",
    );

    expect(checkAiAssets(root)).toEqual([
      '.agents/skills/tdd/SKILL.md frontmatter repeats the key "description".',
    ]);
  });
});

test("checkAiAssets reports a skill name that differs from its directory", () => {
  withAiAssets((root) => {
    write(
      root,
      ".agents/skills/tdd/SKILL.md",
      "---\nname: test-first\ndescription: Test first.\n---\n\n# tdd\n",
    );

    expect(checkAiAssets(root)).toEqual([
      '.agents/skills/tdd/SKILL.md name "test-first" must match its directory "tdd".',
    ]);
  });
});

test("checkAiAssets reports a skill name that breaks the naming rule", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/test--first/SKILL.md", skill("test--first"));
    symlinkSync("../../.agents/skills/test--first", join(root, ".claude/skills/test--first"));

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/test--first/SKILL.md name must be 1-64 lowercase letters, digits, and single hyphens.",
    ]);
  });
});

test("checkAiAssets reports a skill name longer than 64 characters", () => {
  withAiAssets((root) => {
    const name = "a".repeat(65);
    write(root, `.agents/skills/${name}/SKILL.md`, skill(name));
    symlinkSync(`../../.agents/skills/${name}`, join(root, `.claude/skills/${name}`));

    expect(checkAiAssets(root)).toEqual([
      `.agents/skills/${name}/SKILL.md name must be 1-64 lowercase letters, digits, and single hyphens.`,
    ]);
  });
});

test("checkAiAssets reports a skill without a description", () => {
  withAiAssets((root) => {
    write(root, ".agents/skills/tdd/SKILL.md", "---\nname: tdd\n---\n\n# tdd\n");

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md description must be a non-empty string of at most 1024 characters.",
    ]);
  });
});

test("checkAiAssets reports a skill description longer than 1024 characters", () => {
  withAiAssets((root) => {
    write(
      root,
      ".agents/skills/tdd/SKILL.md",
      `---\nname: tdd\ndescription: ${"a".repeat(1025)}\n---\n\n# tdd\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      ".agents/skills/tdd/SKILL.md description must be a non-empty string of at most 1024 characters.",
    ]);
  });
});

test("checkAiAssets accepts quoted and folded skill descriptions", () => {
  withAiAssets((root) => {
    write(
      root,
      ".agents/skills/tdd/SKILL.md",
      '---\nname: tdd\ndescription: "Use when: a change needs a test first."\n---\n\n# tdd\n',
    );
    write(
      root,
      ".agents/skills/concise-writing/SKILL.md",
      "---\nname: concise-writing\ndescription: >-\n  Use when an issue or pull request\n  needs concise prose.\n---\n\n# concise-writing\n",
    );

    expect(checkAiAssets(root)).toEqual([]);
  });
});

test("the repository AI assets pass the drift check", () => {
  expect(checkAiAssets(join(import.meta.dir, ".."))).toEqual([]);
});

test("checkAiAssets reports a missing CLAUDE.md", () => {
  withAiAssets((root) => {
    unlinkSync(join(root, "CLAUDE.md"));

    expect(checkAiAssets(root)).toEqual(["CLAUDE.md is missing."]);
  });
});

test("checkAiAssets reports a CLAUDE.md that does not import AGENTS.md", () => {
  withAiAssets((root) => {
    write(root, "CLAUDE.md", "# CLAUDE.md\n\nSee AGENTS.md for the shared rules.\n");

    expect(checkAiAssets(root)).toEqual([
      "CLAUDE.md must import the shared guidance with a standalone `@AGENTS.md` line.",
    ]);
  });
});

test("checkAiAssets does not count an import inside a code fence", () => {
  withAiAssets((root) => {
    write(root, "CLAUDE.md", "# CLAUDE.md\n\n```md\n@AGENTS.md\n```\n");

    expect(checkAiAssets(root)).toEqual([
      "CLAUDE.md must import the shared guidance with a standalone `@AGENTS.md` line.",
    ]);
  });
});

test("checkAiAssets reports a shared paragraph copied into CLAUDE.md even when rewrapped", () => {
  withAiAssets((root) => {
    write(
      root,
      "CLAUDE.md",
      `${CLAUDE_GUIDANCE}\nUse the repo-native recipes in \`justfile\`\ninstead of ad-hoc shell invocations, and run \`just verify\` before\nreporting completion.\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      'CLAUDE.md repeats shared guidance from AGENTS.md: "Use the repo-native recipes in `justfile` instead of ad-hoc shell invocations, and run `just verify` before reporting completion."',
    ]);
  });
});

test("checkAiAssets reports a shared list item copied under another heading", () => {
  withAiAssets((root) => {
    write(
      root,
      "CLAUDE.md",
      `${CLAUDE_GUIDANCE}\n## Git\n\n- Branch from an up-to-date \`main\` and land every change through a pull request.\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      'CLAUDE.md repeats shared guidance from AGENTS.md: "Branch from an up-to-date `main` and land every change through a pull request."',
    ]);
  });
});

test("checkAiAssets reports a short shared rule copied into CLAUDE.md", () => {
  withAiAssets((root) => {
    write(
      root,
      "CLAUDE.md",
      `${CLAUDE_GUIDANCE}\n- Logic changes are test-first; use the \`tdd\` skill.\n`,
    );

    expect(checkAiAssets(root)).toEqual([
      'CLAUDE.md repeats shared guidance from AGENTS.md: "Logic changes are test-first; use the `tdd` skill."',
    ]);
  });
});

test("checkAiAssets keeps a longer fence open across a shorter inner fence", () => {
  withAiAssets((root) => {
    write(root, "CLAUDE.md", "# CLAUDE.md\n\n````md\n```\n@AGENTS.md\n````\n");

    expect(checkAiAssets(root)).toEqual([
      "CLAUDE.md must import the shared guidance with a standalone `@AGENTS.md` line.",
    ]);
  });
});
