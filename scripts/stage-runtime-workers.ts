#!/usr/bin/env bun

import { cpSync, existsSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

/**
 * What the npm package ships of each runtime-backed worker, as source and
 * destination paths relative to the repository root: the entrypoint and the
 * modules it loads, never the worker's tests or build inputs.
 */
const RUNTIME_WORKER_FILES: readonly (readonly [string, string])[] = [
  [
    "packages/python-scanner/docbridge_python_scanner.py",
    "dist/workers/python/docbridge_python_scanner.py",
  ],
  [
    "packages/python-scanner/docbridge_python_scanner",
    "dist/workers/python/docbridge_python_scanner",
  ],
  ["packages/ruby-scanner/bin", "dist/workers/ruby/bin"],
  ["packages/ruby-scanner/lib", "dist/workers/ruby/lib"],
  [
    "packages/java-scanner/build/docbridge-java-scanner.jar",
    "dist/workers/java/docbridge-java-scanner.jar",
  ],
];

/**
 * Copy the Python and Ruby workers and the built Java JAR into `dist/workers/`,
 * replacing whatever an earlier build staged there.
 */
export function stageRuntimeWorkers(root: string = repoRoot): void {
  for (const [source] of RUNTIME_WORKER_FILES) {
    if (!existsSync(join(root, source))) {
      const hint = source.endsWith(".jar") ? "run `just build-java-scanner` first" : "restore it";
      throw new Error(`${source} is missing; ${hint}.`);
    }
  }
  rmSync(join(root, "dist/workers"), { recursive: true, force: true });
  for (const [source, destination] of RUNTIME_WORKER_FILES) {
    cpSync(join(root, source), join(root, destination), {
      recursive: true,
      filter: (path) => !isBuildDebris(path),
    });
  }
}

/** Bytecode caches and dotfiles a local run of the worker leaves behind. */
function isBuildDebris(path: string): boolean {
  const name = basename(path);
  return name === "__pycache__" || name.endsWith(".pyc") || name.startsWith(".");
}

if (import.meta.main) {
  try {
    stageRuntimeWorkers();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
