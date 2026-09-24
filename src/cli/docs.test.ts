import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileDocumentationReader,
  parseDocsCommand,
  runDocs,
  type DocumentationReader,
} from "./docs";
import { CliError } from "./errors";
import { run } from "./index";
import { capture } from "./test-support";

function withUserDocs(
  files: Record<string, string>,
  callback: (packageRoot: string) => void,
): void {
  const packageRoot = mkdtempSync(join(tmpdir(), "docbridge-docs-"));
  const docsRoot = join(packageRoot, "docs", "user");
  mkdirSync(docsRoot, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(docsRoot, name), content);
  }
  try {
    callback(packageRoot);
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
}

test("file documentation reader rejects a document without a description", () => {
  withUserDocs({ "broken.md": "---\ntitle: Broken\n---\n# Broken\n" }, (packageRoot) => {
    const reader = createFileDocumentationReader(packageRoot);

    expect(() => reader.list()).toThrow("description");
  });
});

test("file documentation reader reports unavailable documentation when the directory is missing", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "docbridge-docs-missing-"));
  try {
    const reader = createFileDocumentationReader(packageRoot);

    expect(() => reader.list()).toThrow("Documentation is unavailable in this installation.");
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("file documentation reader reports unavailable documentation when no documents are packaged", () => {
  withUserDocs({}, (packageRoot) => {
    const reader = createFileDocumentationReader(packageRoot);

    expect(() => reader.list()).toThrow("Documentation is unavailable in this installation.");
  });
});

test("file documentation reader hides link annotations but preserves fenced examples", () => {
  withUserDocs(
    {
      "linking.md": [
        "---",
        "description: Write links.",
        "---",
        "# Annotations",
        "",
        "<!-- @code src/core/markdown.ts#scanMarkdown -->",
        "",
        "## Documentation to code",
        "",
        "```md",
        "<!-- @code src/auth.ts#login -->",
        "## Login Flow",
        "```",
        "",
      ].join("\n"),
    },
    (packageRoot) => {
      const reader = createFileDocumentationReader(packageRoot);

      expect(reader.show("linking")).not.toContain("src/core/markdown.ts#scanMarkdown");
      expect(reader.show("linking")).toContain("<!-- @code src/auth.ts#login -->");
    },
  );
});

test("parseDocsCommand rejects a missing operation", () => {
  expect(() => parseDocsCommand([])).toThrow(CliError);
});

test("runDocs renders an aligned document list and usage hint", () => {
  const reader: DocumentationReader = {
    list: () => [
      { name: "short", description: "Short description." },
      { name: "longer-name", description: "Long description." },
    ],
    show: () => undefined,
  };
  let output = "";

  const exitCode = runDocs(
    { kind: "list", json: false },
    { stdout: (text) => (output += text), stderr: () => undefined },
    reader,
  );

  expect(exitCode).toBe(0);
  expect(output).toBe(
    "short        Short description.\n" +
      "longer-name  Long description.\n\n" +
      "Run `docbridge docs show <name>` to read a document.\n",
  );
});

test("run docs list emits valid JSON for every packaged document", () => {
  const c = capture();

  const code = run(["docs", "list", "--json"], c.io);

  expect(code).toBe(0);
  expect(JSON.parse(c.out)).toEqual({
    documents: [
      {
        name: "automation",
        description: "Automate DocBridge with coding agents, Git hooks, and CI.",
      },
      {
        name: "commands",
        description: "Choose between check, related, context, graph, docs, and upgrade.",
      },
      {
        name: "configuration",
        description:
          "Configure docbridge.config.json: roots, include patterns, languages, visibility.",
      },
      {
        name: "getting-started",
        description: "Set up DocBridge in an existing TypeScript, Swift, Dart, or Rust project.",
      },
      {
        name: "linking",
        description: "Choose, create, and semantically review @doc and @code links.",
      },
      {
        name: "troubleshooting",
        description: "Diagnose configuration, scanner, parsing, and broken-link errors.",
      },
    ],
    help: "Run `docbridge docs show <name>` to read a document.",
  });
  expect(c.err).toBe("");
});

test("run docs show prints the selected Markdown body without frontmatter", () => {
  const c = capture();

  const code = run(["docs", "show", "commands"], c.io);

  expect(code).toBe(0);
  expect(c.out.startsWith("# Commands\n")).toBe(true);
  expect(c.out).not.toContain("description:");
  expect(c.err).toBe("");
});

test.each(["annotations", "linking-workflow", "link-review", "agent-integration"])(
  "run docs show rejects legacy document name %s",
  (name) => {
    const c = capture();

    const code = run(["docs", "show", name], c.io);

    expect(code).toBe(1);
    expect(c.out).toBe("");
    expect(c.err).toBe(
      [
        `Error: Unknown documentation name: ${name}`,
        "",
        "Available names:",
        "  automation, commands, configuration, getting-started, linking, troubleshooting",
        "",
        "Run `docbridge docs show <name>` to read a document.",
        "",
      ].join("\n"),
    );
  },
);
