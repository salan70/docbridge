import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { RuntimeWorkerLanguage } from "../../../config/scanner-runtimes";
import { clearRuntimeProbeCache, resolveRuntimeWorkerCommand } from "./runtime-worker";
import { runScannerWorkerProcess } from "./scanner-worker";

/**
 * Runs the real Python, Ruby, and Java workers of this checkout through the
 * resolution module, with the runtimes the dev shell puts on `PATH`. A missing
 * runtime fails these tests, as a missing native worker binary fails the
 * Swift, Dart, Rust, and Go integration tests.
 */

const repoRoot = resolve(import.meta.dir, "../../../..");

const ONE_FILE: Readonly<Record<RuntimeWorkerLanguage, { filePath: string; content: string }>> = {
  python: {
    filePath: "src/auth.py",
    content: "# @doc docs/auth.md#login\ndef login():\n    pass\n",
  },
  ruby: {
    filePath: "lib/auth.rb",
    content: "# @doc docs/auth.md#login\ndef login; end\n",
  },
  java: {
    filePath: "src/Auth.java",
    content: "public class Auth {\n  /** @doc docs/auth.md#login */\n  public void login() {}\n}\n",
  },
};

const ENDPOINT: Readonly<Record<RuntimeWorkerLanguage, string>> = {
  python: "src/auth.py#login",
  ruby: "lib/auth.rb#login",
  java: "src/Auth.java#Auth.login()",
};

beforeEach(() => {
  clearRuntimeProbeCache();
});

function scanOneFile(
  language: RuntimeWorkerLanguage,
  command: string[],
  stripEnv: readonly string[],
): unknown {
  const result = runScannerWorkerProcess({
    command,
    stripEnv,
    stdin: JSON.stringify({
      schemaVersion: 1,
      requestId: `runtime-${language}`,
      language,
      projectRoot: repoRoot,
      files: [ONE_FILE[language]],
      options: {},
    }),
  });
  if (!result.ok) {
    throw new Error(`cannot start ${command[0]}: ${String(result.error)}`);
  }
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

test.each<RuntimeWorkerLanguage>(["python", "ruby", "java"])(
  "the %s worker resolves from the source checkout and scans one file",
  (language) => {
    const resolution = resolveRuntimeWorkerCommand(language, { projectRoot: repoRoot });
    if (!resolution.ok) {
      throw new Error(resolution.diagnostic.message);
    }

    expect(resolution.command.at(-1)?.startsWith(join(repoRoot, "packages"))).toBe(true);
    const response = scanOneFile(language, resolution.command, resolution.stripEnv) as {
      language: string;
      files: { links: { source: string; target: string }[] }[];
    };
    expect(response.language).toBe(language);
    expect(response.files[0]?.links).toMatchObject([
      { source: ENDPOINT[language], target: "docs/auth.md#login" },
    ]);
  },
);

test("a relative configured runtime path runs the real worker from the project root", () => {
  const python = Bun.which("python3");
  if (python === null) {
    throw new Error("python3 is not on PATH");
  }
  const projectRoot = mkdtempSync(join(tmpdir(), "docbridge-runtime-override-"));
  try {
    mkdirSync(join(projectRoot, "tools"));
    symlinkSync(python, join(projectRoot, "tools/python3"));

    const resolution = resolveRuntimeWorkerCommand("python", {
      projectRoot,
      command: ["tools/python3"],
    });
    if (!resolution.ok) {
      throw new Error(resolution.diagnostic.message);
    }

    expect(resolution.command[0]).toBe(join(projectRoot, "tools/python3"));
    const response = scanOneFile("python", resolution.command, resolution.stripEnv) as {
      files: unknown[];
    };
    expect(response.files).toHaveLength(1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("a configured runtime that does not exist is unavailable without fallback", () => {
  const resolution = resolveRuntimeWorkerCommand("ruby", {
    projectRoot: repoRoot,
    command: ["/nonexistent/docbridge/ruby"],
  });

  expect(resolution).toMatchObject({
    ok: false,
    diagnostic: {
      code: "code_scanner_unavailable",
      message: expect.stringContaining("scanners.ruby.command (/nonexistent/docbridge/ruby)"),
    },
  });
});
