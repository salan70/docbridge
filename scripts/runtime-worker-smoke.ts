import { chmodSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  RUNTIME_WORKER_LANGUAGES,
  type RuntimeWorkerLanguage,
} from "../src/config/scanner-runtimes";
import { resolveRuntimeWorkerCommand } from "../src/scan/code/worker/runtime-worker";
import { runScannerWorkerProcess } from "../src/scan/code/worker/scanner-worker";

/**
 * Smoke checks for the runtime-backed workers shipped under `dist/workers/`.
 * Each worker is resolved by the same module the core uses, so its probe,
 * flags, and stripped environment are the shipped ones, and then scans one
 * annotated file.
 */

const ONE_FILE: Readonly<
  Record<RuntimeWorkerLanguage, { filePath: string; content: string; source: string }>
> = {
  python: {
    filePath: "src/auth.py",
    content: "# @doc docs/auth.md#login\ndef login():\n    pass\n",
    source: "src/auth.py#login",
  },
  ruby: {
    filePath: "lib/auth.rb",
    content: "# @doc docs/auth.md#login\ndef login; end\n",
    source: "lib/auth.rb#login",
  },
  java: {
    filePath: "src/Auth.java",
    content: "public class Auth {\n  /** @doc docs/auth.md#login */\n  public void login() {}\n}\n",
    source: "src/Auth.java#Auth.login()",
  },
};

type SmokeTarget = {
  /** The `dist` directory of a build or an installed package. */
  distRoot: string;
  projectRoot: string;
};

/**
 * Resolve one worker from `distRoot` and scan one file with it. Returns a
 * one-line summary; throws when resolution, the run, or the response fails.
 */
export async function smokeRuntimeWorker(
  language: RuntimeWorkerLanguage,
  target: SmokeTarget,
): Promise<string> {
  const resolution = await resolveRuntimeWorkerCommand(language, {
    projectRoot: target.projectRoot,
    // A dist directory has no `packages/`, so pointing the source root at it
    // makes the dist entrypoint the only one that can be found.
    sourceRoot: target.distRoot,
    distRoot: target.distRoot,
  }).promise;
  if (!resolution.ok) {
    throw new Error(resolution.diagnostic.message);
  }
  const file = ONE_FILE[language];
  const result = await runScannerWorkerProcess({
    command: resolution.command,
    stripEnv: resolution.stripEnv,
    stdin: JSON.stringify({
      schemaVersion: 1,
      requestId: `smoke-${language}`,
      language,
      projectRoot: target.projectRoot,
      files: [{ filePath: file.filePath, content: file.content }],
      options: {},
    }),
  }).promise;
  if (!result.ok || result.exitCode !== 0) {
    const status = result.ok ? `exited ${result.exitCode}` : String(result.error);
    throw new Error(`${language} worker ${status}: ${result.stderr}`);
  }
  if (!hasLink(result.stdout, file.source)) {
    throw new Error(
      `${language} worker returned no link for ${file.source}: ${result.stdout.slice(0, 500)}`,
    );
  }
  return `${language} worker ran: ${resolution.command.join(" ")}`;
}

/** Smoke every runtime-backed worker in `distRoot`, logging each summary. */
export async function smokeRuntimeWorkers(target: SmokeTarget): Promise<void> {
  for (const language of RUNTIME_WORKER_LANGUAGES) {
    console.log(await smokeRuntimeWorker(language, target));
  }
}

/**
 * A configured runtime that does not exist must be `code_scanner_unavailable`
 * and must not fall back to a runtime on `PATH`.
 */
export async function assertMissingRuntimeUnavailable(
  target: SmokeTarget & { missingRuntime: string },
): Promise<void> {
  const resolution = await resolveRuntimeWorkerCommand("python", {
    projectRoot: target.projectRoot,
    sourceRoot: target.distRoot,
    distRoot: target.distRoot,
    command: [target.missingRuntime],
  }).promise;
  if (resolution.ok) {
    throw new Error(`a missing runtime override resolved to ${resolution.command.join(" ")}`);
  }
  if (resolution.diagnostic.code !== "code_scanner_unavailable") {
    throw new Error(`a missing runtime override reported ${resolution.diagnostic.code}`);
  }
  console.log(`missing runtime reported: ${resolution.diagnostic.message}`);
}

function hasLink(stdout: string, source: string): boolean {
  let response: unknown;
  try {
    response = JSON.parse(stdout);
  } catch {
    return false;
  }
  const links = (response as { files?: { links?: { source?: string; target?: string }[] }[] })
    .files?.[0]?.links;
  return (
    Array.isArray(links) &&
    links.some((link) => link.source === source && link.target === "docs/auth.md#login")
  );
}

/**
 * Run `callback` with every write bit under `root` removed, as in an install
 * owned by another user or on a read-only store, then restore each original
 * mode. On Windows only files become read-only; directories ignore the bit.
 */
export async function withReadOnlyTree(
  root: string,
  callback: () => void | Promise<void>,
): Promise<void> {
  const entries = treeModes(root);
  for (const { path, mode } of entries.toReversed()) {
    chmodSync(path, mode & ~0o222);
  }
  try {
    await callback();
  } finally {
    for (const { path, mode } of entries) {
      chmodSync(path, mode);
    }
  }
}

/** Every file and directory under `root`, parents first; symlinks are skipped. */
function treeModes(root: string): { path: string; mode: number }[] {
  const entries: { path: string; mode: number }[] = [];
  const visit = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return;
    }
    entries.push({ path, mode: stat.mode & 0o7777 });
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) {
        visit(join(path, name));
      }
    }
  };
  visit(root);
  return entries;
}
