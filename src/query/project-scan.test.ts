import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { definition } from "../lsp/navigation";
import { Project } from "../lsp/project";
import type { CodeLanguageAdapter } from "../scan/code/adapter";
import { emptyCodeScanCache } from "../scan/code/scan-cache";
import { typeScriptAdapter } from "../scan/code/typescript";
import { makeProject } from "../test-support";
import { scanProject, scanProjectAsync } from "./project-scan";

test("scanProject omits graph and content artifacts by default", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "src/login.ts": "/** @doc docs/auth.md#login-spec */\nexport function login() {}\n",
    "docs/auth.md": "<!-- @code src/login.ts#login -->\n## Login Spec\n",
  });

  try {
    const outcome = scanProject({ projectRoot: root });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.scan.diagnostics).toEqual([]);
    expect("graph" in outcome.scan).toBe(false);
    expect("contentByFile" in outcome.scan).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProject stops scanning when the manifest is invalid", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": '{ "links": [], }',
    "src/login.ts": "export function login() {}\n",
  });

  try {
    const outcome = scanProject({ projectRoot: root });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0]?.code).toBe("config_file_invalid");
    expect(outcome.diagnostics[0]?.target).toBe("docbridge.links.json");
    expect(outcome.diagnostics[0]?.location?.line).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LSP navigation follows a manifest link in both directions", () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/login.ts#login", doc: "docs/auth.md#login-spec" }],
    }),
    "src/login.ts": "export function login() {}\n",
    "docs/auth.md": "## Login Spec\n",
  });

  try {
    const state = new Project(root).resolve();

    expect(definition(state, "src/login.ts", { line: 1, column: 18 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 1, column: 4 }, end: { line: 1, column: 14 } },
      },
    ]);
    expect(definition(state, "docs/auth.md", { line: 1, column: 5 })).toEqual([
      {
        filePath: "src/login.ts",
        range: { start: { line: 1, column: 17 }, end: { line: 1, column: 22 } },
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const LINKED_PROJECT = {
  "docbridge.config.json": JSON.stringify({
    include: {
      code: { typescript: { patterns: ["src/**/*.ts"] } },
      docs: ["docs/**/*.md"],
    },
  }),
  "docbridge.links.json": JSON.stringify({
    links: [{ code: "src/billing.ts#charge", doc: "docs/billing.md#charge" }],
  }),
  "src/login.ts": "/** @doc docs/auth.md#login-spec */\nexport function login() {}\n",
  "src/billing.ts": "export function charge() {}\n",
  "docs/auth.md":
    "<!-- @code src/login.ts#login -->\n## Login Spec\n\n<!-- @code src/login.ts#gone -->\n## Gone\n",
  "docs/billing.md": "## Charge\n",
};

/** The TypeScript adapter, recording the paths of every batch it scans. */
function recordingTypeScript(batches: string[][]): CodeLanguageAdapter {
  return {
    ...typeScriptAdapter,
    scanFiles(files, options, context) {
      batches.push(files.map((file) => file.filePath));
      return typeScriptAdapter.scanFiles(files, options, context);
    },
  };
}

test("scanProjectAsync produces the scan scanProject produces", async () => {
  const root = makeProject(LINKED_PROJECT);

  try {
    const expected = scanProject({ projectRoot: root, buildGraph: true, keepContent: true });
    const actual = await scanProjectAsync({ projectRoot: root, cache: emptyCodeScanCache() })
      .promise;

    expect(expected.ok).toBe(true);
    expect(actual.ok).toBe(true);
    if (!expected.ok || !actual.ok) {
      return;
    }
    expect(actual.scan).toEqual(expected.scan);
    const billing = actual.scan.codeFiles.find((file) => file.filePath === "src/billing.ts");
    expect(billing?.links.map((link) => link.target)).toEqual(["docs/billing.md#charge"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProjectAsync reuses cached results until the configuration changes", async () => {
  const root = makeProject(LINKED_PROJECT);
  const batches: string[][] = [];
  const adapters = { typescript: recordingTypeScript(batches) };

  try {
    const first = await scanProjectAsync({
      projectRoot: root,
      adapters,
      cache: emptyCodeScanCache(),
    }).promise;
    if (!first.ok) {
      throw new Error("expected the first scan to succeed");
    }
    const second = await scanProjectAsync({ projectRoot: root, adapters, cache: first.cache })
      .promise;
    if (!second.ok) {
      throw new Error("expected the second scan to succeed");
    }
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { typescript: { patterns: ["src/**/*.ts"] } },
          docs: ["docs/**/*.md", "README.md"],
        },
      }),
    );
    await scanProjectAsync({ projectRoot: root, adapters, cache: second.cache }).promise;

    expect(batches).toEqual([
      ["src/billing.ts", "src/login.ts"],
      ["src/billing.ts", "src/login.ts"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProjectAsync stops when the manifest is invalid", async () => {
  const root = makeProject({ ...LINKED_PROJECT, "docbridge.links.json": '{ "links": [], }' });

  try {
    const outcome = await scanProjectAsync({ projectRoot: root, cache: emptyCodeScanCache() })
      .promise;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.diagnostics.map((diagnostic) => diagnostic.target)).toEqual([
        "docbridge.links.json",
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProjectAsync reports a configuration change before it scans", async () => {
  const root = makeProject(LINKED_PROJECT);
  const events: string[] = [];
  const batches: string[][] = [];
  const recording = recordingTypeScript(batches);
  const adapters = {
    typescript: {
      ...recording,
      scanFiles: (...args: Parameters<CodeLanguageAdapter["scanFiles"]>) => {
        events.push("scan");
        return recording.scanFiles(...args);
      },
    },
  };
  const onConfigurationChange = () => events.push("configuration changed");

  try {
    const first = await scanProjectAsync({
      projectRoot: root,
      adapters,
      cache: emptyCodeScanCache(),
      onConfigurationChange,
    }).promise;
    if (!first.ok) {
      throw new Error("expected the first scan to succeed");
    }
    writeFileSync(
      join(root, "docbridge.config.json"),
      JSON.stringify({
        include: {
          code: { typescript: { patterns: ["src/**/*.ts"] } },
          docs: ["docs/**/*.md", "README.md"],
        },
      }),
    );
    await scanProjectAsync({
      projectRoot: root,
      adapters,
      cache: first.cache,
      onConfigurationChange,
    }).promise;

    expect(events).toEqual(["scan", "configuration changed", "scan"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("both scan forms hand the configured scanners to every adapter", async () => {
  const scanners = { python: { command: ["tools/python3", "-X", "utf8"] } };
  const root = makeProject({
    ...LINKED_PROJECT,
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
      scanners,
    }),
  });
  const contexts: unknown[] = [];
  const adapters = {
    typescript: {
      ...typeScriptAdapter,
      scanFiles: (...args: Parameters<CodeLanguageAdapter["scanFiles"]>) => {
        contexts.push(args[2]);
        return typeScriptAdapter.scanFiles(...args);
      },
    },
  };

  try {
    scanProject({ projectRoot: root, adapters });
    await scanProjectAsync({ projectRoot: root, adapters, cache: emptyCodeScanCache() }).promise;

    expect(contexts).toEqual([
      { projectRoot: root, scanners },
      { projectRoot: root, scanners },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
