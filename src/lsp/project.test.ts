import { beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { counterpartsOf } from "../link/graph";
import { createScannerWorkerAdapter } from "../scan/code/dispatch";
import {
  clearRuntimeProbeCache,
  resolveRuntimeWorkerCommand,
} from "../scan/code/worker/runtime-worker";
import type { ScannerWorkerProcessResult } from "../scan/code/worker/scanner-worker";
import { isAbortError, settledCancelable } from "../shared/cancelable";
import { codes, makeProject } from "../test-support";
import { heldTypeScript } from "./fixtures";
import { Project } from "./project";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../examples/typescript");
const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

describe(Project, () => {
  test("clearOverlay reverts the file to its on-disk version", async () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      CODE_FILE,
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport function login() {}\n",
    );
    await project.resolveAsync().promise;
    expect(codes(project.state.diagnostics)).toContain("doc_anchor_not_found");

    project.clearOverlay(CODE_FILE);
    await project.resolveAsync().promise;

    expect(project.state.diagnostics).toEqual([]);
    expect(
      counterpartsOf(project.state.graph, `${CODE_FILE}#login`).map((e) => e.endpoint),
    ).toEqual([`${DOC_FILE}#login-spec`]);
  });

  test("an open buffer that matches a code pattern but is not on disk is scanned", async () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      "src/auth/unsaved.ts",
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport function unsaved() {}\n",
    );
    await project.resolveAsync().promise;

    expect(project.state.contentByFile.has("src/auth/unsaved.ts")).toBe(true);
    expect(codes(project.state.diagnostics)).toContain("doc_anchor_not_found");
  });

  test("an open buffer with its language's excluded suffix is not scanned", async () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      "src/auth/unsaved.d.ts",
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport declare function unsaved(): void;\n",
    );
    await project.resolveAsync().promise;

    expect(project.state.contentByFile.has("src/auth/unsaved.d.ts")).toBe(false);
    expect(project.state.diagnostics).toEqual([]);
  });

  test("an open buffer that an exclude pattern selects is not scanned", async () => {
    const root = makeProject({
      "docbridge.config.json": JSON.stringify({
        include: {
          code: {
            typescript: { patterns: ["src/**/*.ts"], exclude: ["src/**/*.gen.ts"] },
          },
          docs: ["docs/**/*.md"],
        },
      }),
      "docs/auth.md": "# Auth\n",
    });
    try {
      const project = new Project(root);
      project.setOverlay("src/unsaved.gen.ts", "export const generated = 1;\n");
      project.setOverlay("src/unsaved.ts", "export const kept = 1;\n");
      await project.resolveAsync().promise;

      expect(project.state.contentByFile.has("src/unsaved.gen.ts")).toBe(false);
      expect(project.state.contentByFile.has("src/unsaved.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const BOTH_FILES = ["src/auth/login.ts", "src/auth/session.ts"];

describe("Project.resolveAsync", () => {
  test("commits the state that resolve computes", async () => {
    const project = new Project(EXAMPLE_ROOT);

    const state = await project.resolveAsync().promise;

    expect(project.state).toBe(state);
    expect(state).toEqual(await new Project(EXAMPLE_ROOT).resolveAsync().promise);
  });

  test("sends only the changed file to the scanner on the next scan", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const first = project.resolveAsync();
    (await held.waitForBatch(0)).release();
    await first.promise;

    project.setOverlay(CODE_FILE, "export async function login() {}\n");
    const second = project.resolveAsync();
    (await held.waitForBatch(1)).release();
    await second.promise;

    expect(held.batches.map((batch) => batch.files)).toEqual([BOTH_FILES, [CODE_FILE]]);
    expect(codes(project.state.diagnostics)).toContain("code_backlink_not_found");
  });

  test("a scan overtaken by an overlay change commits neither its state nor its cache", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const stale = project.resolveAsync();

    project.setOverlay(CODE_FILE, "export async function login() {}\n");
    (await held.waitForBatch(0)).release();

    expect(isAbortError(await stale.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(project.state.contentByFile.size).toBe(0);
    const next = project.resolveAsync();
    (await held.waitForBatch(1)).release();
    await next.promise;
    expect(held.batches.map((batch) => batch.files)).toEqual([BOTH_FILES, BOTH_FILES]);
  });

  test("cancelling a scan stops its scanner and commits nothing", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const task = project.resolveAsync();
    const batch = await held.waitForBatch(0);

    task.cancel();

    expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(batch.cancelled).toBe(true);
    expect(project.state.contentByFile.size).toBe(0);
  });

  test("a configuration error commits a state that carries only that error", async () => {
    const root = makeProject({ "docbridge.config.json": "{ not json" });
    try {
      const state = await new Project(root).resolveAsync().promise;

      expect(codes(state.diagnostics)).toEqual(["config_file_invalid"]);
      expect(state.contentByFile.size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Project runtime probes", () => {
  beforeEach(() => {
    clearRuntimeProbeCache();
  });

  test("a configuration change probes a runtime-backed worker again", async () => {
    const pkg = makeProject({ "packages/python-scanner/docbridge_python_scanner.py": "" });
    const root = makeProject({
      "docbridge.config.json": JSON.stringify({
        include: { code: { go: { patterns: ["src/**/*.go"] } }, docs: ["docs/**/*.md"] },
      }),
      "src/a.go": "package a\n",
    });
    let probes = 0;
    // A runtime-backed resolution standing in for a registered runtime language.
    const adapter = createScannerWorkerAdapter(
      "go",
      {
        commandAsync: ({ projectRoot }) =>
          resolveRuntimeWorkerCommand("python", {
            projectRoot,
            sourceRoot: pkg,
            env: {},
            platform: "linux",
            probe: () => {
              probes += 1;
              return settledCancelable({ kind: "ok", runtime: "cpython", version: "3.12.4" });
            },
          }),
      },
      { run: () => settledCancelable(EXITED) },
    );
    const project = new Project(root, { adapters: { go: adapter } });

    try {
      await project.resolveAsync().promise;
      await project.resolveAsync().promise;
      writeFileSync(
        join(root, "docbridge.config.json"),
        JSON.stringify({
          include: {
            code: { go: { patterns: ["src/**/*.go"] } },
            docs: ["docs/**/*.md", "README.md"],
          },
        }),
      );
      await project.resolveAsync().promise;

      expect(probes).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});

describe("Project scan cache", () => {
  beforeEach(() => {
    clearRuntimeProbeCache();
  });

  test("a runtime that changes behind the same command rescans results cached under the old one", async () => {
    const pkg = makeProject({ "packages/python-scanner/docbridge_python_scanner.py": "" });
    const root = makeProject({
      "docbridge.config.json": JSON.stringify({
        include: { code: { go: { patterns: ["src/**/*.go"] } }, docs: ["docs/**/*.md"] },
      }),
      "src/a.go": "package a\n",
    });
    // PATH decides which python3 runs; the command stays `python3 -I -S <entry>`.
    const env = { PATH: "/opt/python-3.10/bin" };
    const versions: Record<string, string> = {
      "/opt/python-3.10/bin": "3.10.14",
      "/opt/python-3.12/bin": "3.12.4",
    };
    let requests = 0;
    // A runtime-backed resolution standing in for a registered runtime language.
    const adapter = createScannerWorkerAdapter(
      "go",
      {
        commandAsync: ({ projectRoot }) =>
          resolveRuntimeWorkerCommand("python", {
            projectRoot,
            sourceRoot: pkg,
            env: { ...env },
            platform: "linux",
            probe: () =>
              settledCancelable({
                kind: "ok",
                runtime: "cpython",
                version: versions[env.PATH] ?? "",
              }),
          }),
      },
      {
        run: (input) => {
          requests += 1;
          return settledCancelable(parseErrorResponse(input.stdin));
        },
      },
    );
    const project = new Project(root, { adapters: { go: adapter } });

    try {
      await project.resolveAsync().promise;
      await project.resolveAsync().promise;
      expect(requests).toBe(1);

      env.PATH = "/opt/python-3.12/bin";
      await project.resolveAsync().promise;

      expect(requests).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});

/** A worker response reporting a parse error, which a later scan may reuse, for every file. */
function parseErrorResponse(stdin: string): ScannerWorkerProcessResult {
  const request = JSON.parse(stdin) as {
    requestId: string;
    language: string;
    files: { filePath: string }[];
  };
  const files = request.files.map(({ filePath }) => ({
    filePath,
    symbols: [],
    undocumentedSymbols: [],
    links: [],
    diagnostics: [
      { severity: "error", code: "code_parse_error", target: filePath, message: "bad syntax" },
    ],
  }));
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      requestId: request.requestId,
      language: request.language,
      files,
    }),
    stderr: "",
  };
}

const EXITED: ScannerWorkerProcessResult = { ok: true, exitCode: 2, stdout: "", stderr: "" };
