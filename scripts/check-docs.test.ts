import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkDocumentation } from "./check-docs";

const canonicalNames = [
  "getting-started",
  "configuration",
  "linking",
  "commands",
  "automation",
  "troubleshooting",
] as const;

function write(root: string, path: string, content: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

function withDocumentation(callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-check-docs-"));
  const englishLinks = canonicalNames.map((name) => `[${name}](user/${name}.md)`).join("\n");
  const japaneseLinks = canonicalNames.map((name) => `[${name}](user/${name}.md)`).join("\n");

  write(root, "README.md", "[Documentation](docs/README.md)\n[日本語](docs/ja/README.md)\n");
  write(
    root,
    "docs/README.md",
    `# Documentation\n\n${englishLinks}\n[Writing](contributing/writing.md)\n`,
  );
  write(root, "docs/ja/README.md", `# ドキュメント\n\n${japaneseLinks}\n`);
  write(root, "docs/contributing/documentation.md", "# Documentation Guidelines\n");
  write(root, "docs/contributing/writing.md", "# Writing Guidelines\n");
  write(root, "editors/vscode/README.md", "# VS Code\n");
  for (const name of canonicalNames) {
    write(root, `docs/user/${name}.md`, `---\ndescription: Read ${name}.\n---\n\n# ${name}\n`);
    write(root, `docs/ja/user/${name}.md`, `# ${name}\n`);
  }

  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checkDocumentation accepts the canonical bilingual documentation structure", () => {
  withDocumentation((root) => {
    expect(checkDocumentation(root)).toEqual([]);
  });
});

test("checkDocumentation reports missing and unexpected canonical guides", () => {
  withDocumentation((root) => {
    unlinkSync(join(root, "docs/ja/user/commands.md"));
    write(root, "docs/user/advanced.md", "---\ndescription: Extra.\n---\n\n# Advanced\n");

    expect(checkDocumentation(root)).toEqual(
      expect.arrayContaining([
        "docs/ja/user is missing canonical guide: commands.md",
        "docs/user contains unexpected guide: advanced.md",
      ]),
    );
  });
});

test("checkDocumentation reports a canonical guide missing from navigation", () => {
  withDocumentation((root) => {
    write(root, "docs/README.md", "# Documentation\n");

    expect(checkDocumentation(root)).toContain(
      "docs/README.md does not link to docs/user/commands.md",
    );
  });
});

test("checkDocumentation requires contributor writing guidance in navigation", () => {
  withDocumentation((root) => {
    write(root, "docs/README.md", "# Documentation\n");

    expect(checkDocumentation(root)).toContain(
      "docs/README.md does not link to docs/contributing/writing.md",
    );
  });
});

test("checkDocumentation validates links in the contributor writing guidance", () => {
  withDocumentation((root) => {
    write(root, "docs/contributing/writing.md", "# Writing\n\n[Missing](missing.md)\n");

    expect(checkDocumentation(root)).toContain(
      "docs/contributing/writing.md links to missing file: docs/contributing/missing.md",
    );
  });
});

test("checkDocumentation rejects DocBridge annotations in Japanese guides", () => {
  withDocumentation((root) => {
    write(
      root,
      "docs/ja/user/linking.md",
      "<!-- @code src/core/links.ts#parseLinkTarget -->\n# Linking\n",
    );

    expect(checkDocumentation(root)).toContain(
      "docs/ja/user/linking.md must not contain @code annotations",
    );
  });
});

test("checkDocumentation allows annotation examples in Japanese fenced code", () => {
  withDocumentation((root) => {
    write(
      root,
      "docs/ja/user/linking.md",
      "# Linking\n\n```md\n<!-- @code src/auth.ts#login -->\n## Login\n```\n",
    );

    expect(checkDocumentation(root)).toEqual([]);
  });
});

test("checkDocumentation reports broken relative files and heading fragments", () => {
  withDocumentation((root) => {
    write(
      root,
      "docs/user/getting-started.md",
      [
        "---",
        "description: Start.",
        "---",
        "",
        "# Getting Started",
        "",
        "[Missing file](missing.md)",
        "[Missing heading](commands.md#missing-heading)",
        "",
      ].join("\n"),
    );

    expect(checkDocumentation(root)).toEqual(
      expect.arrayContaining([
        "docs/user/getting-started.md links to missing file: docs/user/missing.md",
        "docs/user/getting-started.md links to missing heading: docs/user/commands.md#missing-heading",
      ]),
    );
  });
});

test("checkDocumentation validates the target of a badge-wrapped link", () => {
  withDocumentation((root) => {
    write(
      root,
      "README.md",
      "[Documentation](docs/README.md)\n[![日本語](https://example.com/badge.svg)](docs/missing.md)\n",
    );

    expect(checkDocumentation(root)).toContain("README.md links to missing file: docs/missing.md");
  });
});

test("checkDocumentation ignores link-looking syntax inside inline code", () => {
  withDocumentation((root) => {
    write(
      root,
      "docs/user/getting-started.md",
      "---\ndescription: Start.\n---\n\n# Start\n\nUse `[Missing](missing.md)` as an example.\n",
    );

    expect(checkDocumentation(root)).toEqual([]);
  });
});

test("checkDocumentation resolves GitHub-style duplicate heading suffixes", () => {
  withDocumentation((root) => {
    write(
      root,
      "docs/user/commands.md",
      "---\ndescription: Commands.\n---\n\n# Commands\n\n## Run!\n\n## Run!\n",
    );
    write(
      root,
      "docs/user/getting-started.md",
      "---\ndescription: Start.\n---\n\n# Start\n\n[Second run](commands.md#run-1)\n",
    );

    expect(checkDocumentation(root)).toEqual([]);
  });
});

test("just verify includes the documentation structure check", () => {
  const justfile = readFileSync(join(import.meta.dir, "..", "justfile"), "utf8");

  expect(justfile).toMatch(/^verify: .*\bcheck-docs\b/m);
  expect(justfile).toContain("\ncheck-docs:\n    bun run scripts/check-docs.ts\n");
});

test("the repository documentation passes the structural check", () => {
  const root = join(import.meta.dir, "..");

  expect(checkDocumentation(root)).toEqual([]);
});
