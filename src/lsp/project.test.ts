import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { counterpartsOf } from "../link/graph";
import { codes } from "../test-support";
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
