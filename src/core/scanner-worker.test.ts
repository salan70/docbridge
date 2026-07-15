import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

import {
  clangModuleCachePath,
  invokeScannerWorker,
  runScannerWorkerProcess,
  type ScannerWorkerProcessResult,
} from "./scanner-worker";
import type { ScannerWorkerRequest } from "./scanner-worker";

test("clangModuleCachePath is rooted in the OS temp dir and scoped per user", () => {
  const path = clangModuleCachePath();

  expect(path.startsWith(tmpdir())).toBe(true);
  expect(path).toContain("docbridge-clang-module-cache");
  // Not the world-shared, non-portable hardcoded location.
  expect(path).not.toBe("/tmp/docbridge-clang-module-cache");
  if (typeof process.getuid === "function") {
    expect(path).toContain(String(process.getuid()));
  }
});

test("runScannerWorkerProcess pipes stdin to the worker and captures stdout, stderr, and exit code", () => {
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", "cat; echo err >&2; exit 3"],
    stdin: "ping",
  });

  expect(result).toEqual({
    ok: true,
    exitCode: 3,
    stdout: "ping",
    stderr: "err\n",
  });
});

test("runScannerWorkerProcess reports ok: false when the command does not exist", () => {
  const result = runScannerWorkerProcess({
    command: ["docbridge-nonexistent-worker-command"],
    stdin: "",
  });

  expect(result.ok).toBe(false);
});

test("runScannerWorkerProcess captures worker output larger than one megabyte", () => {
  const bytes = 2 * 1024 * 1024;
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", `head -c ${bytes} /dev/zero | tr '\\0' a`],
    stdin: "",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(bytes);
  }
});

test("runScannerWorkerProcess exposes the clang module cache path to the worker", () => {
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", 'printf "%s" "$CLANG_MODULE_CACHE_PATH"'],
    stdin: "",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.stdout).toBe(clangModuleCachePath());
  }
});

test("runScannerWorkerProcess reports ok: false when the worker is killed by a signal", () => {
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", "kill -KILL $$"],
    stdin: "",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(String(result.error)).toContain("SIGKILL");
  }
});

test("invokeScannerWorker sends one JSON request with files and options", () => {
  let captured: string | undefined;

  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-1",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "public struct Auth {}\n" }],
      options: { visibility: ["public", "open"] },
    },
    ["mock-worker"],
    (input): ScannerWorkerProcessResult => {
      captured = input.stdin;
      return {
        ok: true,
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          requestId: "req-1",
          language: "swift",
          files: [
            {
              filePath: "Sources/Auth.swift",
              symbols: [],
              undocumentedSymbols: [],
              links: [],
              diagnostics: [],
            },
          ],
        }),
        stderr: "",
      };
    },
  );

  expect(result.ok).toBe(true);
  expect(captured).toBeDefined();
  expect(JSON.parse(captured ?? "")).toEqual({
    schemaVersion: 1,
    requestId: "req-1",
    language: "swift",
    projectRoot: "/project",
    files: [{ filePath: "Sources/Auth.swift", content: "public struct Auth {}\n" }],
    options: { visibility: ["public", "open"] },
  } satisfies ScannerWorkerRequest);
});

test("invokeScannerWorker maps response files to CodeScanResult", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-2",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["mock-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        requestId: "req-2",
        language: "swift",
        files: [
          {
            filePath: "Sources/Auth.swift",
            symbols: [
              {
                kind: "code",
                language: "swift",
                filePath: "Sources/Auth.swift",
                symbolName: "AuthService",
                canonicalId: "AuthService",
                endpoint: "Sources/Auth.swift#AuthService",
                location: { filePath: "Sources/Auth.swift", line: 1, column: 15 },
              },
            ],
            undocumentedSymbols: [],
            links: [],
            diagnostics: [],
          },
        ],
      }),
      stderr: "debug output\n",
    }),
  );

  expect(result).toEqual({
    ok: true,
    codeFiles: [
      {
        language: "swift",
        filePath: "Sources/Auth.swift",
        symbols: [
          {
            kind: "code",
            language: "swift",
            filePath: "Sources/Auth.swift",
            symbolName: "AuthService",
            canonicalId: "AuthService",
            endpoint: "Sources/Auth.swift#AuthService",
            location: { filePath: "Sources/Auth.swift", line: 1, column: 15 },
          },
        ],
        undocumentedSymbols: [],
        links: [],
        diagnostics: [],
      },
    ],
    stderr: "debug output\n",
  });
});

test("invokeScannerWorker rejects responses with missing requested files", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-missing-file",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["mock-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        requestId: "req-missing-file",
        language: "swift",
        files: [],
      }),
      stderr: "",
    }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_failed");
    expect(result.diagnostic.message).toContain("worker response files must match requested files");
  }
});

test("invokeScannerWorker rejects responses with unexpected file paths", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-wrong-file",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["mock-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        requestId: "req-wrong-file",
        language: "swift",
        files: [
          {
            filePath: "Sources/Other.swift",
            symbols: [],
            undocumentedSymbols: [],
            links: [],
            diagnostics: [],
          },
        ],
      }),
      stderr: "",
    }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_failed");
    expect(result.diagnostic.message).toContain("worker response files must match requested files");
  }
});

test("invokeScannerWorker emits scanner unavailable when the process cannot start", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-3",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["missing-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: false,
      error: new Error("ENOENT"),
      stderr: "",
    }),
  );

  expect(result).toEqual({
    ok: false,
    diagnostic: {
      severity: "error",
      code: "code_scanner_unavailable",
      language: "swift",
      target: "swift",
      message: "Swift scanner worker is unavailable: ENOENT",
    },
    stderr: "",
  });
});

test("invokeScannerWorker emits scanner failed for invalid stdout and preserves stderr", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-4",
      language: "dart",
      projectRoot: "/project",
      files: [{ filePath: "lib/auth.dart", content: "" }],
      options: {},
    },
    ["mock-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: true,
      exitCode: 0,
      stdout: "{",
      stderr: "stack trace\n",
    }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_failed");
    expect(result.diagnostic.language).toBe("dart");
    expect(result.diagnostic.target).toBe("dart");
    expect(result.diagnostic.message).toContain("Dart scanner worker failed");
    expect(result.stderr).toBe("stack trace\n");
  }
});
