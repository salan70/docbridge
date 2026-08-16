import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { counterpartsOf } from "../core/graph";
import { codes } from "../core/test-support";
import { Project } from "./project";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../examples/typescript");
const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

describe(Project, () => {
  test("builds a correct whole-project graph from disk", () => {
    const project = new Project(EXAMPLE_ROOT);
    project.resolve();

    expect(project.state.diagnostics).toEqual([]);
    expect(
      counterpartsOf(project.state.graph, `${CODE_FILE}#login`).map((e) => e.endpoint),
    ).toEqual([`${DOC_FILE}#login-spec`]);
    expect(project.state.contentByFile.has(CODE_FILE)).toBe(true);
  });

  test("a buffer overlay overrides on-disk content for an open file", () => {
    const project = new Project(EXAMPLE_ROOT);
    project.setOverlay(
      CODE_FILE,
      "/**\n * @doc docs/auth.md#nonexistent\n */\nexport function login() {}\n",
    );
    project.resolve();

    // The overlaid @doc points at a missing anchor, so a diagnostic appears that
    // does not exist for the on-disk content — proving the overlay was scanned.
    expect(codes(project.state.diagnostics)).toContain("doc_anchor_not_found");
  });

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
});
