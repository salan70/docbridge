import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runtimeWorkerEntrypoints } from "../src/scan/code/worker/runtime-worker";
import { verifyDistPackage } from "./verify-dist";

/** A dist root with an executable CLI and every runtime-backed worker entrypoint. */
function writeDist(root: string): string {
  const distCli = join(root, "dist/index.js");
  mkdirSync(join(distCli, ".."), { recursive: true });
  writeFileSync(distCli, "#!/usr/bin/env node\n");
  chmodSync(distCli, 0o755);
  for (const { dist } of Object.values(runtimeWorkerEntrypoints())) {
    mkdirSync(join(root, "dist", dist, ".."), { recursive: true });
    writeFileSync(join(root, "dist", dist), "");
  }
  return distCli;
}

test("verifyDistPackage rejects packaged scanner binaries without executable bits", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-verify-dist-"));
  try {
    writeDist(root);
    const scanner = join(root, "dist/bin/darwin-arm64/docbridge-swift-scanner");
    mkdirSync(join(scanner, ".."), { recursive: true });
    writeFileSync(scanner, "#!/bin/sh\n");
    chmodSync(scanner, 0o644);

    await expect(
      verifyDistPackage(root, {
        run: () => {},
        runRuntimeWorker: () => {},
      }),
    ).rejects.toThrow("dist/bin/darwin-arm64/docbridge-swift-scanner is not executable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyDistPackage rejects a dist without a runtime-backed worker entrypoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-verify-dist-"));
  try {
    writeDist(root);
    rmSync(join(root, "dist/workers/java"), { recursive: true });

    await expect(
      verifyDistPackage(root, {
        run: () => {},
        runRuntimeWorker: () => {},
      }),
    ).rejects.toThrow(
      "dist/workers/java/docbridge-java-scanner.jar does not exist. Run `just build` first.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyDistPackage removes the bytecode a worker run leaves in dist before packing", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-verify-dist-"));
  try {
    writeDist(root);
    const cache = join(root, "dist/workers/python/docbridge_python_scanner/__pycache__");

    await verifyDistPackage(root, {
      run: () => {},
      runRuntimeWorker: () => {
        mkdirSync(cache, { recursive: true });
        writeFileSync(join(cache, "protocol.cpython-313.pyc"), "");
      },
    });

    expect(existsSync(cache)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyDistPackage runs dist checks and every runtime-backed worker from the inspected root", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-verify-dist-"));
  try {
    const distCli = writeDist(root);

    const calls: { command: string[]; cwd: string | undefined }[] = [];
    const workers: { language: string; distRoot: string }[] = [];
    await verifyDistPackage(root, {
      run: (command, cwd) => {
        calls.push({ command, cwd });
      },
      runRuntimeWorker: (language, distRoot) => {
        workers.push({ language, distRoot });
      },
    });

    expect(calls).toEqual([
      { command: [distCli, "--version"], cwd: root },
      { command: [distCli, "--help"], cwd: root },
      { command: [distCli, "docs", "list", "--json"], cwd: root },
      { command: [distCli, "docs", "show", "getting-started"], cwd: root },
      {
        command: [distCli, "check", "--root", "examples/typescript"],
        cwd: root,
      },
      {
        command: [distCli, "upgrade", "--check", "--agent-target", "none"],
        cwd: root,
      },
    ]);
    expect(workers).toEqual([
      { language: "python", distRoot: join(root, "dist") },
      { language: "ruby", distRoot: join(root, "dist") },
      { language: "java", distRoot: join(root, "dist") },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
