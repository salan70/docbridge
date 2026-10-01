import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

import {
  clangModuleCachePath,
  createLazyWorkerResponseValidator,
  invokeScannerWorker,
  runScannerWorkerProcess,
  type ScannerWorkerProcessResult,
} from "./scanner-worker";

test("worker response schema compilation is lazy and cached", () => {
  let compileCount = 0;
  const compiled = { validate: true };
  const validator = createLazyWorkerResponseValidator(() => {
    compileCount += 1;
    return compiled;
  });

  expect(compileCount).toBe(0);
  expect(validator()).toBe(compiled);
  expect(validator()).toBe(compiled);
  expect(compileCount).toBe(1);
});

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

test("runScannerWorkerProcess reports a start failure when the command does not exist", () => {
  const result = runScannerWorkerProcess({
    command: ["docbridge-nonexistent-worker-command"],
    stdin: "",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("start");
  }
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

test("runScannerWorkerProcess removes the variables named in stripEnv from the worker environment", () => {
  process.env.DOCBRIDGE_TEST_INJECTED = "injected";
  process.env.DOCBRIDGE_TEST_KEPT = "kept";
  try {
    const result = runScannerWorkerProcess({
      command: [
        "sh",
        "-c",
        'printf "%s|%s" "${DOCBRIDGE_TEST_INJECTED-unset}" "${DOCBRIDGE_TEST_KEPT-unset}"',
      ],
      stdin: "",
      stripEnv: ["DOCBRIDGE_TEST_INJECTED"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout).toBe("unset|kept");
    }
  } finally {
    delete process.env.DOCBRIDGE_TEST_INJECTED;
    delete process.env.DOCBRIDGE_TEST_KEPT;
  }
});

test("invokeScannerWorker passes stripEnv to the process runner", () => {
  let received: readonly string[] | undefined;
  invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "strip",
      language: "go",
      projectRoot: "/project",
      files: [],
      options: {},
    },
    ["worker"],
    (input) => {
      received = input.stripEnv;
      return { ok: true, exitCode: 1, stdout: "", stderr: "" };
    },
    ["RUBYOPT", "JAVA_TOOL_OPTIONS"],
  );

  expect(received).toEqual(["RUBYOPT", "JAVA_TOOL_OPTIONS"]);
});

test("runScannerWorkerProcess reports an execution failure when the worker is killed by a signal", () => {
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", "kill -KILL $$"],
    stdin: "",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("SIGKILL");
  }
});

test("runScannerWorkerProcess stops a worker that outlives its timeout and reports an execution failure", () => {
  const started = Date.now();
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", "sleep 5"],
    stdin: "",
    timeoutMs: 100,
  });

  expect(Date.now() - started).toBeLessThan(4_000);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("timed out after 100 ms");
  }
});

test("runScannerWorkerProcess reports output above the cap as an execution failure", () => {
  const result = runScannerWorkerProcess({
    command: ["sh", "-c", "head -c 100000 /dev/zero | tr '\\0' a"],
    stdin: "",
    maxOutputBytes: 1_000,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("more than 1000 bytes");
  }
});

test("invokeScannerWorker gives the worker 30 seconds plus one second per requested file", () => {
  const timeouts: Array<number | undefined> = [];
  const run = (input: { timeoutMs?: number }): ScannerWorkerProcessResult => {
    timeouts.push(input.timeoutMs);
    return { ok: true, exitCode: 1, stdout: "", stderr: "" };
  };
  const base = {
    schemaVersion: 1 as const,
    requestId: "timeout",
    language: "go" as const,
    projectRoot: "/project",
    options: {},
  };

  invokeScannerWorker({ ...base, files: [{ filePath: "a.go", content: "" }] }, ["worker"], run);
  invokeScannerWorker(
    {
      ...base,
      files: [
        { filePath: "a.go", content: "" },
        { filePath: "b.go", content: "" },
        { filePath: "c.go", content: "" },
      ],
    },
    ["worker"],
    run,
  );

  expect(timeouts).toEqual([31_000, 33_000]);
});

test("invokeScannerWorker reports a worker that started and then failed as scanner failed", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-crash",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["crashing-worker"],
    (): ScannerWorkerProcessResult => ({
      ok: false,
      kind: "execution",
      error: new Error("worker terminated by signal SIGKILL"),
      stderr: "fatal\n",
    }),
  );

  expect(result).toEqual({
    ok: false,
    diagnostic: {
      severity: "error",
      code: "code_scanner_failed",
      language: "swift",
      target: "swift",
      message: "Swift scanner worker failed: worker terminated by signal SIGKILL",
    },
    stderr: "fatal\n",
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

test("invokeScannerWorker rejects malformed nested scan results", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-malformed-symbol",
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
        requestId: "req-malformed-symbol",
        language: "swift",
        files: [
          {
            filePath: "Sources/Auth.swift",
            symbols: [
              {
                kind: "code",
                language: "swift",
                filePath: "Sources/Auth.swift",
                symbolName: "Auth",
                canonicalId: "Auth",
                endpoint: "Sources/Auth.swift#Auth",
                location: { filePath: "Sources/Auth.swift", line: "one", column: 15 },
              },
            ],
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
    expect(result.diagnostic.message).toContain("/files/0/symbols/0/location/line");
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

// Resolution already restores the executable bit, so a permission error at
// spawn time means the mode is not the problem: the filesystem itself refuses
// to execute, which is what a `noexec` mount does. On macOS that is where
// `bunx` caches packages. See issue #74.
test("invokeScannerWorker explains exec-denied spawn failures as a noexec mount", () => {
  const error = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-noexec",
      language: "dart",
      projectRoot: "/project",
      files: [{ filePath: "lib/auth.dart", content: "" }],
      options: {},
    },
    ["/private/tmp/bunx-cache/docbridge/dist/bin/darwin-arm64/docbridge_dart_scanner"],
    (): ScannerWorkerProcessResult => ({ ok: false, error, stderr: "" }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_unavailable");
    expect(result.diagnostic.message).toContain(
      "/private/tmp/bunx-cache/docbridge/dist/bin/darwin-arm64",
    );
    expect(result.diagnostic.message).toContain("noexec");
    expect(result.diagnostic.message).toContain("dependency");
  }
});

test("invokeScannerWorker explains an EPERM spawn failure the same way", () => {
  const error = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-eperm",
      language: "swift",
      projectRoot: "/project",
      files: [{ filePath: "Sources/Auth.swift", content: "" }],
      options: {},
    },
    ["/mnt/store/dist/bin/linux-x64/docbridge-swift-scanner"],
    (): ScannerWorkerProcessResult => ({ ok: false, error, stderr: "" }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.message).toContain("noexec");
    expect(result.diagnostic.message).toContain("/mnt/store/dist/bin/linux-x64");
  }
});

test("invokeScannerWorker renders a non-Error spawn rejection readably", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-nonerror",
      language: "dart",
      projectRoot: "/project",
      files: [{ filePath: "lib/auth.dart", content: "" }],
      options: {},
    },
    ["/dist/bin/linux-x64/docbridge_dart_scanner"],
    (): ScannerWorkerProcessResult => ({ ok: false, error: "spawn refused", stderr: "" }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.message).toBe("Dart scanner worker is unavailable: spawn refused");
  }
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

test("invokeScannerWorker accepts a member symbol flagged isMember", () => {
  const result = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-5",
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
        requestId: "req-5",
        language: "swift",
        files: [
          {
            filePath: "Sources/Auth.swift",
            symbols: [],
            undocumentedSymbols: [
              {
                kind: "code",
                language: "swift",
                filePath: "Sources/Auth.swift",
                symbolName: "login",
                canonicalId: "AuthService.login(email:)",
                endpoint: "Sources/Auth.swift#AuthService.login(email:)",
                location: { filePath: "Sources/Auth.swift", line: 2, column: 3 },
                isMember: true,
              },
            ],
            links: [],
            diagnostics: [],
          },
        ],
      }),
      stderr: "",
    }),
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.codeFiles[0]?.undocumentedSymbols[0]?.isMember).toBe(true);
  }
});
