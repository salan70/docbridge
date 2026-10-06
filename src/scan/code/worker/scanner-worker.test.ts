import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deferred, isAbortError, settledCancelable } from "../../../shared/cancelable";
import {
  clangModuleCachePath,
  invokeScannerWorker,
  killRunningWorkers,
  runScannerWorkerProcess,
  workerProcessEnv,
  type ScannerWorkerProcessResult,
  type ScannerWorkerRun,
} from "./scanner-worker";

type ProcessInput = Parameters<ScannerWorkerRun>[0];

/** Invoke the worker with a process runner that settles at once with what `run` returns. */
function invoke(
  request: Parameters<typeof invokeScannerWorker>[0],
  command: string[],
  run: (input: ProcessInput) => ScannerWorkerProcessResult,
  stripEnv?: readonly string[],
): ReturnType<typeof invokeScannerWorker>["promise"] {
  return invokeScannerWorker(request, command, (input) => settledCancelable(run(input)), stripEnv)
    .promise;
}

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

test("runScannerWorkerProcess captures worker output larger than one megabyte", async () => {
  const bytes = 2 * 1024 * 1024;
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", `head -c ${bytes} /dev/zero | tr '\\0' a`],
    stdin: "",
  }).promise;

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(bytes);
  }
});

test("workerProcessEnv strips a variable in any letter case on Windows only", () => {
  process.env.DocBridge_Test_Mixed = "mixed";
  try {
    expect(workerProcessEnv(["DOCBRIDGE_TEST_MIXED"], "win32")).not.toHaveProperty(
      "DocBridge_Test_Mixed",
    );
    expect(workerProcessEnv(["DOCBRIDGE_TEST_MIXED"], "linux")).toHaveProperty(
      "DocBridge_Test_Mixed",
      "mixed",
    );
  } finally {
    delete process.env.DocBridge_Test_Mixed;
  }
});

test("invokeScannerWorker passes stripEnv to the process runner", async () => {
  let received: readonly string[] | undefined;
  await invoke(
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

/** A shell script that writes `each` bytes to stdout, then `each` bytes to stderr. */
function writeBothStreams(each: number): string {
  return `head -c ${each} /dev/zero | tr '\\0' a; head -c ${each} /dev/zero | tr '\\0' b >&2`;
}

test("invokeScannerWorker gives the worker 30 seconds plus one second per requested file", async () => {
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

  await invoke({ ...base, files: [{ filePath: "a.go", content: "" }] }, ["worker"], run);
  await invoke(
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

test("invokeScannerWorker reports a worker that started and then failed as scanner failed", async () => {
  const result = await invoke(
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

test("invokeScannerWorker rejects responses with missing requested files", async () => {
  const result = await invoke(
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

test("invokeScannerWorker rejects responses with unexpected file paths", async () => {
  const result = await invoke(
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

test("invokeScannerWorker rejects malformed nested scan results", async () => {
  const result = await invoke(
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

test("invokeScannerWorker emits scanner unavailable when the process cannot start", async () => {
  const result = await invoke(
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
test("invokeScannerWorker explains exec-denied spawn failures as a noexec mount", async () => {
  const error = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
  const result = await invoke(
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

test("invokeScannerWorker explains an EPERM spawn failure the same way", async () => {
  const error = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
  const result = await invoke(
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

test("invokeScannerWorker renders a non-Error spawn rejection readably", async () => {
  const result = await invoke(
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

test("invokeScannerWorker emits scanner failed for invalid stdout and preserves stderr", async () => {
  const result = await invoke(
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

test("invokeScannerWorker accepts a member symbol flagged isMember", async () => {
  const result = await invoke(
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

/** Poll `condition` until it holds; bounded so a broken contract fails instead of hanging. */
async function eventually(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition did not hold in time");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("runScannerWorkerProcess pipes stdin to the worker and captures stdout, stderr, and exit code", async () => {
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "cat; echo err >&2; exit 3"],
    stdin: "ping",
  }).promise;

  expect(result).toEqual({ ok: true, exitCode: 3, stdout: "ping", stderr: "err\n" });
});

test("runScannerWorkerProcess decodes multi-byte output split across chunks", async () => {
  const text = "ログイン🌟".repeat(50_000);
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "cat"],
    stdin: text,
  }).promise;

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.stdout).toBe(text);
  }
});

test("runScannerWorkerProcess reports a start failure when the command does not exist", async () => {
  const result = await runScannerWorkerProcess({
    command: ["docbridge-nonexistent-worker-command"],
    stdin: "",
  }).promise;

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("start");
  }
});

test("runScannerWorkerProcess reports an execution failure when the worker is killed by a signal", async () => {
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "kill -KILL $$"],
    stdin: "",
  }).promise;

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("SIGKILL");
    expect(result.cause).toEqual({ type: "signal", signal: "SIGKILL" });
  }
});

test("runScannerWorkerProcess stops a worker that outlives its timeout", async () => {
  const started = Date.now();
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "exec sleep 5"],
    stdin: "",
    timeoutMs: 100,
  }).promise;

  expect(Date.now() - started).toBeLessThan(4_000);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("timed out after 100 ms");
    expect(result.cause).toEqual({ type: "timeout" });
  }
});

test("runScannerWorkerProcess kills a timed-out worker's descendants and settles at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-descendant-"));
  try {
    const pidFile = join(dir, "pid");
    const started = Date.now();
    const result = await runScannerWorkerProcess({
      command: ["sh", "-c", `sleep 2 & echo $! > '${pidFile}'; wait`],
      stdin: "",
      timeoutMs: 300,
    }).promise;

    expect(Date.now() - started).toBeLessThan(1_500);
    expect(result).toMatchObject({ ok: false, kind: "execution" });
    const descendant = Number(readFileSync(pidFile, "utf8").trim());
    await eventually(() => !isAlive(descendant), 1_500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runScannerWorkerProcess settles a killed worker whose escaped descendant holds its output", async () => {
  // The descendant starts its own process group, so killing the worker's group
  // misses it; it keeps stdout and stderr open for 3 s.
  const escape =
    "require('node:child_process').spawn('sleep', ['3'], " +
    "{ detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); setTimeout(() => {}, 30000);";
  const started = Date.now();
  const result = await runScannerWorkerProcess({
    command: [process.execPath, "-e", escape],
    stdin: "",
    timeoutMs: 300,
  }).promise;

  expect(Date.now() - started).toBeLessThan(2_000);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("timed out after 300 ms");
  }
});

test("runScannerWorkerProcess reports stdout above the cap as an execution failure", async () => {
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "head -c 100000 /dev/zero | tr '\\0' a"],
    stdin: "",
    maxOutputBytes: 1_000,
  }).promise;

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
    expect(String(result.error)).toContain("more than 1000 bytes");
    expect(result.cause).toEqual({ type: "output-limit" });
  }
});

test("runScannerWorkerProcess caps stdout and stderr together", async () => {
  const over = await runScannerWorkerProcess({
    command: ["sh", "-c", writeBothStreams(600)],
    stdin: "",
    maxOutputBytes: 1_000,
  }).promise;
  const atCap = await runScannerWorkerProcess({
    command: ["sh", "-c", writeBothStreams(500)],
    stdin: "",
    maxOutputBytes: 1_000,
  }).promise;

  expect(over).toMatchObject({ ok: false, kind: "execution" });
  expect(String((over as { error?: unknown }).error)).toContain("more than 1000 bytes");
  expect(atCap).toMatchObject({ ok: true, exitCode: 0 });
});

test("runScannerWorkerProcess reports stderr above the cap as an execution failure", async () => {
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "head -c 100000 /dev/zero | tr '\\0' a >&2"],
    stdin: "",
    maxOutputBytes: 1_000,
  }).promise;

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("execution");
  }
});

test("runScannerWorkerProcess survives a worker that exits without reading its input", async () => {
  const result = await runScannerWorkerProcess({
    command: ["sh", "-c", "exit 0"],
    stdin: "x".repeat(4 * 1024 * 1024),
  }).promise;

  expect(result).toEqual({ ok: true, exitCode: 0, stdout: "", stderr: "" });
});

test("runScannerWorkerProcess removes the variables named in stripEnv and sets the clang cache", async () => {
  process.env.DOCBRIDGE_TEST_INJECTED = "injected";
  try {
    const result = await runScannerWorkerProcess({
      command: [
        "sh",
        "-c",
        'printf "%s|%s" "${DOCBRIDGE_TEST_INJECTED-unset}" "$CLANG_MODULE_CACHE_PATH"',
      ],
      stdin: "",
      stripEnv: ["DOCBRIDGE_TEST_INJECTED"],
    }).promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout).toBe(`unset|${clangModuleCachePath()}`);
    }
  } finally {
    delete process.env.DOCBRIDGE_TEST_INJECTED;
  }
});

test("cancelling an asynchronous worker run kills the worker and rejects with an AbortError", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-cancel-"));
  try {
    const pidFile = join(dir, "pid");
    const task = runScannerWorkerProcess({
      command: [
        "sh",
        "-c",
        `echo $$ > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}' && exec sleep 30`,
      ],
      stdin: "",
    });
    await eventually(() => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(isAlive(pid)).toBe(true);

    task.cancel();

    const error = await task.promise.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
    await eventually(() => !isAlive(pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancelling an asynchronous worker run kills the worker's descendants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-cancel-descendant-"));
  try {
    const pidFile = join(dir, "pid");
    const task = runScannerWorkerProcess({
      command: [
        "sh",
        "-c",
        `sleep 30 & echo $! > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'; wait`,
      ],
      stdin: "",
    });
    await eventually(() => existsSync(pidFile));
    const descendant = Number(readFileSync(pidFile, "utf8").trim());
    expect(isAlive(descendant)).toBe(true);

    task.cancel();

    const error = await task.promise.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
    await eventually(() => !isAlive(descendant), 1_500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "killRunningWorkers kills a running worker and its descendants",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "docbridge-kill-running-"));
    try {
      const pidFile = join(dir, "pid");
      const task = runScannerWorkerProcess({
        command: [
          "sh",
          "-c",
          `sleep 30 & echo $! > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'; wait`,
        ],
        stdin: "",
      });
      await eventually(() => existsSync(pidFile));
      const descendant = Number(readFileSync(pidFile, "utf8").trim());
      expect(isAlive(descendant)).toBe(true);

      killRunningWorkers();

      expect(await task.promise).toMatchObject({
        ok: false,
        cause: { type: "signal", signal: "SIGKILL" },
      });
      await eventually(() => !isAlive(descendant), 1_500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "killRunningWorkers does not signal the group of a worker that has exited",
  async () => {
    // The worker leaves a process in its group that holds its output open, then
    // exits. Once the leader is reaped its ID may name another group, so a later
    // kill must not target it.
    const dir = mkdtempSync(join(tmpdir(), "docbridge-kill-exited-"));
    try {
      const pidFile = join(dir, "pid");
      const task = runScannerWorkerProcess({
        command: [
          "sh",
          "-c",
          `sleep 1 & echo "$$ $!" > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'`,
        ],
        stdin: "",
      });
      await eventually(() => existsSync(pidFile));
      const [leader, descendant] = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
      await eventually(() => !isAlive(leader ?? -1));
      expect(isAlive(descendant ?? -1)).toBe(true);

      killRunningWorkers();

      // The run settles when the descendant's own sleep releases the output,
      // not when a kill reaches it.
      const started = Date.now();
      expect(await task.promise).toMatchObject({ ok: true, exitCode: 0 });
      expect(Date.now() - started).toBeGreaterThan(500);
      await eventually(() => !isAlive(descendant ?? -1));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("invokeScannerWorker interprets the worker response", async () => {
  const inputs: Array<{ stripEnv?: readonly string[]; timeoutMs?: number }> = [];
  const result = await invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-async",
      language: "go",
      projectRoot: "/project",
      files: [{ filePath: "a.go", content: "package a\n" }],
      options: {},
    },
    ["go-worker"],
    (input) => {
      inputs.push(input);
      return {
        promise: Promise.resolve({
          ok: true,
          exitCode: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            requestId: "req-async",
            language: "go",
            files: [
              {
                filePath: "a.go",
                symbols: [],
                undocumentedSymbols: [],
                links: [],
                diagnostics: [],
              },
            ],
          }),
          stderr: "",
        }),
        cancel: () => undefined,
      };
    },
    ["GOFLAGS"],
  ).promise;

  expect(result).toEqual({
    ok: true,
    codeFiles: [
      {
        language: "go",
        filePath: "a.go",
        symbols: [],
        undocumentedSymbols: [],
        links: [],
        diagnostics: [],
      },
    ],
    stderr: "",
  });
  expect(inputs.map((input) => [input.stripEnv, input.timeoutMs])).toEqual([[["GOFLAGS"], 31_000]]);
});

test("cancelling invokeScannerWorker cancels the process run", () => {
  let cancelled = false;
  const task = invokeScannerWorker(
    {
      schemaVersion: 1,
      requestId: "req-async-cancel",
      language: "go",
      projectRoot: "/project",
      files: [{ filePath: "a.go", content: "" }],
      options: {},
    },
    ["go-worker"],
    () => ({
      promise: deferred<ScannerWorkerProcessResult>().promise,
      cancel: () => {
        cancelled = true;
      },
    }),
  );

  task.cancel();

  expect(cancelled).toBe(true);
});
