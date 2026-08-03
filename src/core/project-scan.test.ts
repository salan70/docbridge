import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { counterpartsOf } from "./graph";
import { scanProject } from "./project-scan";
import { makeProject } from "./test-support";

test("scanProject loads config, scans managed files, and builds one graph", () => {
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
    expect([...outcome.scan.contentByFile.keys()]).toEqual(["src/login.ts", "docs/auth.md"]);
    expect(
      counterpartsOf(outcome.scan.graph, "src/login.ts#login").map(
        (counterpart) => counterpart.endpoint,
      ),
    ).toEqual(["docs/auth.md#login-spec"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanProject stops after an invalid config", () => {
  const root = makeProject({ "docbridge.config.json": "{ invalid" });

  try {
    const outcome = scanProject({ projectRoot: root });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "config_file_invalid",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
