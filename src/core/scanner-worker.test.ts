import { expect, test } from "bun:test";

import {
  invokeScannerWorker,
  type ScannerWorkerProcessResult,
} from "./scanner-worker";
import type { ScannerWorkerRequest } from "./scanner-worker";

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
          files: [],
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
