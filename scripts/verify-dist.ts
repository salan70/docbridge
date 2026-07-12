#!/usr/bin/env bun

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const scannerPlatformKeys = ["darwin-arm64", "linux-x64"] as const;
const scannerExecutableNames = [
  "speclink-swift-scanner",
  "speclink_dart_scanner",
] as const;

export type VerifyDistOptions = {
  run?: (command: string[], cwd: string) => void;
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

  const runCommand = options.run ?? run;
  runCommand([distCli, "--version"], root);
  runCommand([distCli, "--help"], root);
  runCommand([distCli, "check", "--root", "examples/typescript"], root);
}

function assertPackagedScannersExecutable(root: string): void {
  for (const platform of scannerPlatformKeys) {
    for (const executable of scannerExecutableNames) {
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
