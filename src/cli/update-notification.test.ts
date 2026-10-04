import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pkg from "../../package.json";
import type { CliRuntime } from "./index";
import { run } from "./index";
import type { InitPrompts } from "./init";
import { capture } from "./test-support";

const NEWER: CliRuntime["latest"] = { status: "ok", latest: "99.0.0", source: "cache" };

async function runCheck(cliRuntime: CliRuntime) {
  const c = capture();
  const code = await run(
    ["check", "--root", "examples/typescript"],
    c.io,
    { prompts: { isInteractive: false, confirm: () => false, select: (_m, _c, d) => d } },
    cliRuntime,
  );
  return { code, out: c.out, err: c.err };
}

const prompts: InitPrompts = {
  isInteractive: false,
  confirm: () => false,
  select: (_message, _choices, defaultChoice) => defaultChoice,
};

test("a newer stable release produces one notice on stderr", async () => {
  const result = await runCheck({ latest: NEWER, env: {}, isTty: true });

  expect(result.code).toBe(0);
  expect(result.err).toContain(`Update available: docbridge ${pkg.version} -> 99.0.0`);
  expect(result.err).toContain("docbridge@latest");
  expect(result.err).toContain("DOCBRIDGE_NO_UPDATE_CHECK=1");
  expect(result.err.trimEnd().split("\n")).toHaveLength(3);
});

test("the notice never reaches stdout", async () => {
  expect((await runCheck({ latest: NEWER, env: {}, isTty: true })).out).not.toContain(
    "Update available",
  );
});

test("an up-to-date registry answer prints nothing", async () => {
  expect(
    (
      await runCheck({
        latest: { status: "ok", latest: pkg.version, source: "cache" },
        env: {},
        isTty: true,
      })
    ).err,
  ).toBe("");
});

test("a prerelease on the registry prints nothing", async () => {
  expect(
    (
      await runCheck({
        latest: { status: "ok", latest: "99.0.0-rc.1", source: "cache" },
        env: {},
        isTty: true,
      })
    ).err,
  ).toBe("");
});

test("an unavailable registry answer prints nothing", async () => {
  expect(
    (await runCheck({ latest: { status: "unavailable", source: "network" }, env: {}, isTty: true }))
      .err,
  ).toBe("");
});

test("no lookup at all prints nothing", async () => {
  expect((await runCheck({ env: {}, isTty: true })).err).toBe("");
});

test("a non-TTY invocation prints nothing", async () => {
  expect((await runCheck({ latest: NEWER, env: {}, isTty: false })).err).toBe("");
});

test("CI prints nothing", async () => {
  expect((await runCheck({ latest: NEWER, env: { CI: "true" }, isTty: true })).err).toBe("");
});

test("the opt-out environment variable prints nothing", async () => {
  expect(
    (await runCheck({ latest: NEWER, env: { DOCBRIDGE_NO_UPDATE_CHECK: "1" }, isTty: true })).err,
  ).toBe("");
});

test("JSON output prints nothing", async () => {
  const c = capture();
  const code = await run(
    ["check", "--root", "examples/typescript", "--json"],
    c.io,
    { prompts: { isInteractive: false, confirm: () => false, select: (_m, _c, d) => d } },
    { latest: NEWER, env: {}, isTty: true },
  );

  expect(code).toBe(0);
  expect(c.err).toBe("");
  expect(() => JSON.parse(c.out)).not.toThrow();
});

test("the upgrade command prints no separate notice", async () => {
  const c = capture();
  await run(
    ["upgrade", "--check", "--agent-target", "none"],
    c.io,
    { prompts: { isInteractive: false, confirm: () => false, select: (_m, _c, d) => d } },
    { latest: NEWER, env: {}, isTty: true },
  );

  expect(c.err).toBe("");
  expect(c.out).toContain("Status: outdated");
});

test("--version prints the notice on stderr and keeps stdout exact", async () => {
  const c = capture();
  const code = await run(["--version"], c.io, undefined, { latest: NEWER, env: {}, isTty: true });

  expect(code).toBe(0);
  expect(c.out).toBe(`${pkg.version}\n`);
  expect(c.err).toContain("Update available");
});

test("a failing command prints no notice", async () => {
  const c = capture();
  const code = await run(["check", "--root", "definitely-missing-root"], c.io, undefined, {
    latest: NEWER,
    env: {},
    isTty: true,
  });

  expect(code).toBe(1);
  expect(c.err).not.toContain("Update available");
});

test("the notice describes the install selected by --root, not the working directory", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "docbridge-notice-root-"));
  const workingDirectory = mkdtempSync(join(tmpdir(), "docbridge-notice-cwd-"));
  try {
    const packageRoot = join(projectRoot, "node_modules", "docbridge");
    mkdirSync(join(packageRoot, "templates", "skills"), { recursive: true });
    const c = capture();

    await run(
      ["check", "--root", projectRoot],
      c.io,
      { prompts, packageRoot },
      { latest: NEWER, env: {}, isTty: true, currentDirectory: workingDirectory },
    );

    expect(c.err).toContain("Upgrade command (project install)");
    expect(c.err).not.toContain("docbridge@latest -g");
    expect(c.err).not.toContain("install -g");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("the notice keeps project scope when invoked from a nested directory", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "docbridge-notice-nested-"));
  try {
    const packageRoot = join(projectRoot, "node_modules", "docbridge");
    mkdirSync(join(packageRoot, "templates", "skills"), { recursive: true });
    const nested = join(projectRoot, "packages", "web");
    mkdirSync(nested, { recursive: true });
    const c = capture();

    await run(
      ["check", "--root", nested],
      c.io,
      { prompts, packageRoot },
      { latest: NEWER, env: {}, isTty: true, currentDirectory: nested },
    );

    expect(c.err).toContain("Upgrade command (project install)");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
