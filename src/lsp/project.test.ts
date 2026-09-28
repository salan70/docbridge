import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { counterpartsOf } from "../core/graph";
import { codes } from "../core/test-support";
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
});
