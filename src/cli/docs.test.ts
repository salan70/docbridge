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

function capture(): {
  out: string;
  err: string;
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
} {
  const state = { out: "", err: "" };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      stdout: (text) => {
        state.out += text;
      },
      stderr: (text) => {
        state.err += text;
      },
    },
  };
}

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

test("file documentation reader lists documents by name with their descriptions", () => {
  withUserDocs(
    {
      "troubleshooting.md": "---\ndescription: Diagnose failures.\n---\n# Troubleshooting\n",
      "annotations.md": "---\ndescription: Write links.\n---\n# Annotations\n",
    },
    (packageRoot) => {
      const reader = createFileDocumentationReader(packageRoot);

      expect(reader.list()).toEqual([
        { name: "annotations", description: "Write links." },
        { name: "troubleshooting", description: "Diagnose failures." },
      ]);
    },
  );
});

test("file documentation reader decodes a quoted YAML description", () => {
  withUserDocs(
    {
      "configuration.md":
        '---\ndescription: "Configure docbridge.config.json: roots and languages."\n---\n# Configuration\n',
    },
    (packageRoot) => {
      const reader = createFileDocumentationReader(packageRoot);

      expect(reader.list()).toEqual([
        {
          name: "configuration",
          description: "Configure docbridge.config.json: roots and languages.",
        },
      ]);
    },
  );
});

test("file documentation reader returns the Markdown body without frontmatter", () => {
  withUserDocs(
    { "commands.md": "---\ndescription: Choose a command.\n---\n\n# Commands\n\nUse check.\n" },
    (packageRoot) => {
      const reader = createFileDocumentationReader(packageRoot);

      expect(reader.show("commands")).toBe("# Commands\n\nUse check.\n");
    },
  );
});

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
      "annotations.md": [
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

      expect(reader.show("annotations")).not.toContain("src/core/markdown.ts#scanMarkdown");
      expect(reader.show("annotations")).toContain("<!-- @code src/auth.ts#login -->");
    },
  );
});

test("parseDocsCommand accepts list with JSON output", () => {
  expect(parseDocsCommand(["list", "--json"])).toEqual({ kind: "list", json: true });
});

test("parseDocsCommand accepts show with one document name", () => {
  expect(parseDocsCommand(["show", "configuration"])).toEqual({
    kind: "show",
    name: "configuration",
  });
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

test("runDocs emits the documented JSON list shape", () => {
  const documents = [{ name: "commands", description: "Choose a command." }];
  const reader: DocumentationReader = { list: () => documents, show: () => undefined };
  let output = "";

  const exitCode = runDocs(
    { kind: "list", json: true },
    { stdout: (text) => (output += text), stderr: () => undefined },
    reader,
  );

  expect(exitCode).toBe(0);
  expect(JSON.parse(output)).toEqual({
    documents,
    help: "Run `docbridge docs show <name>` to read a document.",
  });
});

test("runDocs writes a selected document body verbatim", () => {
  const reader: DocumentationReader = {
    list: () => [{ name: "commands", description: "Choose a command." }],
    show: (name) => (name === "commands" ? "# Commands\n" : undefined),
  };
  let output = "";

  const exitCode = runDocs(
    { kind: "show", name: "commands" },
    { stdout: (text) => (output += text), stderr: () => undefined },
    reader,
  );

  expect(exitCode).toBe(0);
  expect(output).toBe("# Commands\n");
});

test("runDocs rejects an unknown name", () => {
  const reader: DocumentationReader = {
    list: () => [
      { name: "annotations", description: "Write links." },
      { name: "commands", description: "Choose a command." },
    ],
    show: () => undefined,
  };

  expect(() =>
    runDocs(
      { kind: "show", name: "missing" },
      { stdout: () => undefined, stderr: () => undefined },
      reader,
    ),
  ).toThrow("Unknown documentation name: missing");
});

test("run docs list emits valid JSON for every packaged document", () => {
  const c = capture();

  const code = run(["docs", "list", "--json"], c.io);

  expect(code).toBe(0);
  expect(JSON.parse(c.out)).toEqual({
    documents: [
      {
        name: "agent-integration",
        description: "Wire DocBridge into coding agents, hooks, and CI.",
      },
      {
        name: "annotations",
        description: "Write @doc and @code annotations and valid link targets.",
      },
      {
        name: "commands",
        description: "Choose between check, related, context, and graph.",
      },
      {
        name: "configuration",
        description: "Configure docbridge.config.json: roots, includes, excludes, languages.",
      },
      {
        name: "getting-started",
        description: "Set up DocBridge in an existing TypeScript, Swift, or Dart project.",
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

test("run docs show rejects an unknown name and lists available names", () => {
  const c = capture();

  const code = run(["docs", "show", "missing"], c.io);

  expect(code).toBe(1);
  expect(c.out).toBe("");
  expect(c.err).toContain("Unknown documentation name: missing");
  expect(c.err).toContain("agent-integration, annotations, commands");
});
