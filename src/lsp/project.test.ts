import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { counterpartsOf } from "../link/graph";
import { isAbortError } from "../shared/cancelable";
import { codes, makeProject } from "../test-support";
import { heldTypeScript } from "./fixtures";
import { Project } from "./project";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../examples/typescript");
const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

describe(Project, () => {
  test("clearOverlay reverts the file to its on-disk version", () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      CODE_FILE,
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport function login() {}\n",
    );
    project.resolve();
    expect(codes(project.state.diagnostics)).toContain("doc_anchor_not_found");

    project.clearOverlay(CODE_FILE);
    project.resolve();

    expect(project.state.diagnostics).toEqual([]);
    expect(
      counterpartsOf(project.state.graph, `${CODE_FILE}#login`).map((e) => e.endpoint),
    ).toEqual([`${DOC_FILE}#login-spec`]);
  });

  test("an open buffer that matches a code pattern but is not on disk is scanned", () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      "src/auth/unsaved.ts",
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport function unsaved() {}\n",
    );
    project.resolve();

    expect(project.state.contentByFile.has("src/auth/unsaved.ts")).toBe(true);
    expect(codes(project.state.diagnostics)).toContain("doc_anchor_not_found");
  });

  test("an open buffer with its language's excluded suffix is not scanned", () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      "src/auth/unsaved.d.ts",
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport declare function unsaved(): void;\n",
    );
    project.resolve();

    expect(project.state.contentByFile.has("src/auth/unsaved.d.ts")).toBe(false);
    expect(project.state.diagnostics).toEqual([]);
  });
});

const BOTH_FILES = ["src/auth/login.ts", "src/auth/session.ts"];

describe("Project.resolveAsync", () => {
  test("commits the state that resolve computes", async () => {
    const project = new Project(EXAMPLE_ROOT);

    const state = await project.resolveAsync().promise;

    expect(project.state).toBe(state);
    expect(state).toEqual(new Project(EXAMPLE_ROOT).resolve());
  });

  test("sends only the changed file to the scanner on the next scan", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const first = project.resolveAsync();
    held.batches[0]?.release();
    await first.promise;

    project.setOverlay(CODE_FILE, "export async function login() {}\n");
    const second = project.resolveAsync();
    held.batches[1]?.release();
    await second.promise;

    expect(held.batches.map((batch) => batch.files)).toEqual([BOTH_FILES, [CODE_FILE]]);
    expect(codes(project.state.diagnostics)).toContain("code_backlink_not_found");
  });

  test("a scan overtaken by an overlay change commits neither its state nor its cache", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const stale = project.resolveAsync();

    project.setOverlay(CODE_FILE, "export async function login() {}\n");
    held.batches[0]?.release();

    expect(isAbortError(await stale.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(project.state.contentByFile.size).toBe(0);
    const next = project.resolveAsync();
    held.batches[1]?.release();
    await next.promise;
    expect(held.batches.map((batch) => batch.files)).toEqual([BOTH_FILES, BOTH_FILES]);
  });

  test("cancelling a scan stops its scanner and commits nothing", async () => {
    const held = heldTypeScript();
    const project = new Project(EXAMPLE_ROOT, { adapters: { typescript: held.adapter } });
    const task = project.resolveAsync();

    task.cancel();

    expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(held.batches[0]?.cancelled).toBe(true);
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
