#!/usr/bin/env bun

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  RUNTIME_WORKER_LANGUAGES,
  type RuntimeWorkerLanguage,
} from "../src/config/scanner-runtimes";
import { runtimeWorkerEntrypoints } from "../src/scan/code/worker/runtime-worker";
import {
  supportedScannerExecutableNames,
  supportedScannerPlatformKeys,
} from "../src/scan/code/worker/scanner-executable";
import { smokeRuntimeWorker } from "./runtime-worker-smoke";

const repoRoot = resolve(import.meta.dir, "..");

export type VerifyDistOptions = {
  run?: (command: string[], cwd: string) => void;
  /** Runs one runtime-backed worker from `distRoot` on a one-file request. */
  runRuntimeWorker?: (language: RuntimeWorkerLanguage, distRoot: string) => void | Promise<void>;
};

export async function verifyDistPackage(
  root: string = repoRoot,
  options: VerifyDistOptions = {},
): Promise<void> {
  const distCli = join(root, "dist/index.js");

  if (!existsSync(distCli)) {
    throw new Error("dist/index.js does not exist. Run `just build` first.");
  }

  const content = await readFile(distCli, "utf8");
  if (!content.startsWith("#!/usr/bin/env node\n")) {
    throw new Error("dist/index.js does not preserve the Node shebang.");
  }

  assertExecutable(root, distCli);
  assertPackagedScannersExecutable(root);
  assertRuntimeWorkersPresent(root);

  const runCommand = options.run ?? run;
  runCommand([distCli, "--version"], root);
  runCommand([distCli, "--help"], root);
  runCommand([distCli, "docs", "list", "--json"], root);
  runCommand([distCli, "docs", "show", "getting-started"], root);
  runCommand([distCli, "check", "--root", "examples/typescript"], root);
  // Read-only by construction, so it is safe to run against the repository:
  // it only proves the new command boots from the bundle.
  runCommand([distCli, "upgrade", "--check", "--agent-target", "none"], root);

  const runRuntimeWorker = options.runRuntimeWorker ?? runDistRuntimeWorker;
  for (const language of RUNTIME_WORKER_LANGUAGES) {
    await runRuntimeWorker(language, join(root, "dist"));
  }
  // Running Python from dist caches bytecode beside its modules; `npm pack`
  // runs after this check and must not ship it.
  removeBytecodeCaches(join(root, "dist/workers"));
}

function removeBytecodeCaches(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.name === "__pycache__") {
      rmSync(path, { recursive: true, force: true });
    } else {
      removeBytecodeCaches(path);
    }
  }
}

function assertRuntimeWorkersPresent(root: string): void {
  for (const { dist } of Object.values(runtimeWorkerEntrypoints())) {
    if (!existsSync(join(root, "dist", dist))) {
      throw new Error(`dist/${dist} does not exist. Run \`just build\` first.`);
    }
  }
}

/** Runs the worker against the repository root as its project root. */
async function runDistRuntimeWorker(
  language: RuntimeWorkerLanguage,
  distRoot: string,
): Promise<void> {
  console.log(await smokeRuntimeWorker(language, { distRoot, projectRoot: repoRoot }));
}

function assertPackagedScannersExecutable(root: string): void {
  for (const platform of supportedScannerPlatformKeys()) {
    for (const executable of supportedScannerExecutableNames()) {
      const scannerPath = join(root, "dist/bin", platform, executable);
      if (existsSync(scannerPath)) {
        assertExecutable(root, scannerPath);
      }
    }
  }
}

function assertExecutable(root: string, path: string): void {
  if ((statSync(path).mode & 0o111) === 0) {
    throw new Error(`${relativeToRoot(root, path)} is not executable.`);
  }
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(new TextDecoder().decode(result.stdout));
    console.error(new TextDecoder().decode(result.stderr));
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

function relativeToRoot(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (import.meta.main) {
  try {
    await verifyDistPackage();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
