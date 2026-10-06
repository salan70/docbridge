import { expect, test } from "bun:test";
import { join } from "node:path";

import { formatGateReport, parseChangedFiles } from "./related-gate-report";

const ROOT = join(import.meta.dir, "..");

test("formatGateReport reports nothing when there are no violations", async () => {
  expect(formatGateReport([], [], [])).toBe("");
});

test("formatGateReport names every violation and attaches the flagged content", async () => {
  const report = formatGateReport(
    [
      {
        changedEndpoint: "src/auth/login.ts#login",
        changedFilePath: "src/auth/login.ts",
        counterpartEndpoint: "docs/auth.md#login-spec",
        counterpartFilePath: "docs/auth.md",
      },
    ],
    [
      {
        endpoint: "docs/auth.md#login-spec",
        kind: "doc",
        filePath: "docs/auth.md",
        startLine: 3,
        endLine: 5,
        linkedFrom: ["src/auth/login.ts#login"],
        content: "## Login spec\n\nThe password is verified before the session is issued.",
      },
      {
        endpoint: "docs/unrelated.md#other",
        kind: "doc",
        filePath: "docs/unrelated.md",
        startLine: 1,
        endLine: 2,
        linkedFrom: ["src/other.ts#other"],
        content: "## Other",
      },
    ],
    [],
  );

  expect(report).toContain(
    "src/auth/login.ts#login -> docs/auth.md#login-spec (counterpart not in change set)",
  );
  expect(report).toContain("docs/auth.md#login-spec (linked from src/auth/login.ts#login)");
  expect(report).toContain("The password is verified before the session is issued.");
  expect(report).not.toContain("docs/unrelated.md#other");
});

test("formatGateReport widens the fence around code content holding a backtick run", async () => {
  const report = formatGateReport(
    [
      {
        changedEndpoint: "docs/auth.md#login-spec",
        changedFilePath: "docs/auth.md",
        counterpartEndpoint: "src/auth/login.ts#login",
        counterpartFilePath: "src/auth/login.ts",
      },
    ],
    [
      {
        endpoint: "src/auth/login.ts#login",
        kind: "code",
        filePath: "src/auth/login.ts",
        language: "typescript",
        startLine: 1,
        endLine: 3,
        linkedFrom: ["docs/auth.md#login-spec"],
        content: "/** ```ts\n * login();\n * ``` */\nexport function login() {}",
      },
    ],
    [],
  );

  expect(report).toContain("````ts\n");
  expect(report).toContain("\n````");
});

test("parseChangedFiles drops blank lines and trims each path", async () => {
  expect(parseChangedFiles("src/a.ts\n\n  docs/b.md  \n\n")).toEqual(["src/a.ts", "docs/b.md"]);
  expect(parseChangedFiles("")).toEqual([]);
});

test("formatGateReport warns about partially staged files even with no violations", async () => {
  const report = formatGateReport([], [], ["src/core/related.ts"]);

  expect(report).toContain("src/core/related.ts");
  expect(report).toContain("working tree");
  expect(report).not.toContain("counterpart not in change set");
});

test("formatGateReport keeps the warning alongside reported violations", async () => {
  const report = formatGateReport(
    [
      {
        changedEndpoint: "src/auth/login.ts#login",
        changedFilePath: "src/auth/login.ts",
        counterpartEndpoint: "docs/auth.md#login-spec",
        counterpartFilePath: "docs/auth.md",
      },
    ],
    [],
    ["src/auth/login.ts"],
  );

  expect(report).toContain("counterpart not in change set");
  expect(report).toContain("src/auth/login.ts (also has unstaged changes)");
});

test("the script exits 0 for input naming no managed file", async () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/related-gate-report.ts"],
    cwd: ROOT,
    stdin: new TextEncoder().encode("\0 not/a/real/path\nREADME.md\n"),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
});
