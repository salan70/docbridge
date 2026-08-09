import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/**
 * The repository guardrail is the Git `pre-commit` hook, not agent hooks: a
 * hook wired into one agent's configuration covers only that agent, while
 * `core.hooksPath` covers every contributor and every tool. These paths are
 * asserted absent so the agent-hook surface cannot quietly come back.
 */
const REMOVED_HOOK_PATHS = [
  ".claude/hooks",
  ".claude/settings.json",
  ".codex",
  "examples/hooks",
] as const;

for (const path of REMOVED_HOOK_PATHS) {
  test(`${path} does not exist`, () => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });
}

test("the pre-commit hook is executable", () => {
  const hook = join(ROOT, ".githooks/pre-commit");

  expect(existsSync(hook)).toBe(true);
  expect(statSync(hook).mode & 0o111).not.toBe(0);
});

test("the pre-commit hook runs the blocking gate and then the gate report", () => {
  const hook = readFileSync(join(ROOT, ".githooks/pre-commit"), "utf8");

  const verifyIndex = hook.indexOf("run_just verify");
  const reportIndex = hook.indexOf("run_just related-gate-report");

  expect(verifyIndex).toBeGreaterThanOrEqual(0);
  expect(reportIndex).toBeGreaterThan(verifyIndex);
  // The report stage is awareness, never a verdict, so its status is captured
  // instead of aborting the commit under `set -e`.
  expect(hook).toContain("run_just related-gate-report || gate_status=$?");
});

test("the justfile provides the staged-change gate recipes the hook depends on", () => {
  const justfile = readFileSync(join(ROOT, "justfile"), "utf8");

  expect(justfile).toContain("\nrelated-gate-staged:\n");
  expect(justfile).toContain("\nrelated-gate-report:\n");
  expect(justfile).toContain("git diff --cached --name-only");
});

test("no current document links to the removed hook examples", () => {
  const tracked = trackedFiles().filter(
    (path) =>
      path.endsWith(".md") && path !== "CHANGELOG.md" && !path.startsWith("docs/plans/done/"),
  );

  const offenders = tracked.filter((path) =>
    readFileSync(join(ROOT, path), "utf8").includes("examples/hooks"),
  );

  expect(offenders).toEqual([]);
});

function trackedFiles(): string[] {
  const result = Bun.spawnSync({ cmd: ["git", "ls-files"], cwd: ROOT, stdout: "pipe" });
  return new TextDecoder()
    .decode(result.stdout)
    .split("\n")
    .filter((line) => line !== "");
}
