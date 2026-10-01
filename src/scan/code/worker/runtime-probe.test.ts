import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isAbortError, settledCancelable } from "../../../shared/cancelable";
import {
  probeRuntime,
  probeRuntimeAsync,
  spawnRuntimeProbe,
  type RuntimeProbeSpawn,
  type RuntimeProbeSpawnResult,
} from "./runtime-probe";
import {
  runScannerWorkerProcessAsync,
  workerProcessEnv,
  type ScannerWorkerProcessResult,
  type ScannerWorkerRunAsync,
} from "./scanner-worker";

function exited(stdout: string, status = 0, stderr = ""): RuntimeProbeSpawnResult {
  return { status, signal: null, stdout, stderr };
}

function spawnError(code: string, message: string): RuntimeProbeSpawnResult {
  return {
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error(message), { code }),
  };
}

test("probeRuntime runs the command with --probe, bounded to 10 s and 64 KiB of output", () => {
  const calls: { executable: string; args: string[]; timeout: number; maxBuffer: number }[] = [];
  const spawn: RuntimeProbeSpawn = (executable, args, options) => {
    calls.push({ executable, args, timeout: options.timeout, maxBuffer: options.maxBuffer });
    return exited('{"ok": true, "runtime": "cpython", "version": "3.12.4"}\n');
  };

  probeRuntime(["py", "-3", "-I", "-S", "/opt/docbridge/scanner.py"], [], spawn);

  expect(calls).toEqual([
    {
      executable: "py",
      args: ["-3", "-I", "-S", "/opt/docbridge/scanner.py", "--probe"],
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    },
  ]);
});

test("probeRuntime reports the runtime and version an ok probe prints", () => {
  const outcome = probeRuntime(["python3"], [], () =>
    exited('{"ok": true, "runtime": "cpython", "version": "3.12.4"}\n'),
  );

  expect(outcome).toEqual({ kind: "ok", runtime: "cpython", version: "3.12.4" });
});

test("probeRuntime reports a probe that answers ok: false as rejected with its reason", () => {
  const outcome = probeRuntime(["python3"], [], () =>
    exited('{"ok": false, "reason": "expected CPython, found PyPy 3.10.14"}\n'),
  );

  expect(outcome).toEqual({ kind: "rejected", reason: "expected CPython, found PyPy 3.10.14" });
});

test("probeRuntime reports an executable that cannot be started as unstartable", () => {
  const outcome = probeRuntime(["/opt/missing/python3"], [], () =>
    spawnError("ENOENT", "spawnSync /opt/missing/python3 ENOENT"),
  );

  expect(outcome).toEqual({ kind: "unstartable", reason: "spawnSync /opt/missing/python3 ENOENT" });
});

test("probeRuntime reports a probe that exits unsuccessfully as failed with its stderr", () => {
  const outcome = probeRuntime(["ruby"], [], () =>
    exited("", 1, "ruby: cannot load such file -- json (LoadError)\n"),
  );

  expect(outcome).toEqual({
    kind: "failed",
    reason: "probe exited with status 1: ruby: cannot load such file -- json (LoadError)",
  });
});

test("probeRuntime reports a probe killed by a signal as failed", () => {
  const outcome = probeRuntime(["java"], [], () => ({
    status: null,
    signal: "SIGSEGV",
    stdout: "",
    stderr: "",
  }));

  expect(outcome).toEqual({ kind: "failed", reason: "probe terminated by signal SIGSEGV" });
});

test("probeRuntime reports a probe that outlives the time limit as failed", () => {
  const outcome = probeRuntime(["java"], [], () =>
    spawnError("ETIMEDOUT", "spawnSync java ETIMEDOUT"),
  );

  expect(outcome).toEqual({ kind: "failed", reason: "probe did not finish within 10 s" });
});

test("probeRuntime reports a probe that prints more than the output limit as failed", () => {
  const outcome = probeRuntime(["python3"], [], () =>
    spawnError("ENOBUFS", "spawnSync python3 ENOBUFS"),
  );

  expect(outcome).toEqual({ kind: "failed", reason: "probe printed more than 64 KiB" });
});

test.each([
  ["text that is not JSON", "Python 3.12.4\n"],
  ["two JSON lines", '{"ok": true, "runtime": "cpython", "version": "3.12.4"}\n{"ok": true}\n'],
  ["a JSON array", "[]\n"],
  ["an ok without a version", '{"ok": true, "runtime": "cpython"}\n'],
  ["an ok with a numeric version", '{"ok": true, "runtime": "cpython", "version": 3.12}\n'],
  ["a rejection without a reason", '{"ok": false}\n'],
  ["a non-boolean ok", '{"ok": "yes", "runtime": "cpython", "version": "3.12.4"}\n'],
])("probeRuntime reports %s as malformed probe output", (_label, stdout) => {
  const outcome = probeRuntime(["python3"], [], () => exited(stdout));

  expect(outcome.kind).toBe("failed");
  expect(outcome).toMatchObject({ reason: expect.stringContaining("malformed probe output") });
});

test("probeRuntime starts the probe without the stripped variables", () => {
  process.env.DOCBRIDGE_TEST_PROBE_INJECTED = "injected";
  process.env.DOCBRIDGE_TEST_PROBE_KEPT = "kept";
  try {
    let env: Record<string, string> = {};
    probeRuntime(["python3"], ["DOCBRIDGE_TEST_PROBE_INJECTED"], (_executable, _args, options) => {
      env = options.env;
      return exited('{"ok": true, "runtime": "cpython", "version": "3.12.4"}\n');
    });

    expect(env.DOCBRIDGE_TEST_PROBE_INJECTED).toBeUndefined();
    expect(env.DOCBRIDGE_TEST_PROBE_KEPT).toBe("kept");
  } finally {
    delete process.env.DOCBRIDGE_TEST_PROBE_INJECTED;
    delete process.env.DOCBRIDGE_TEST_PROBE_KEPT;
  }
});

test("probeRuntime bounds a real probe's output with the default spawn", () => {
  const outcome = probeRuntime(
    [process.execPath, "-e", "process.stdout.write('x'.repeat(70000))", "--"],
    [],
  );

  expect(outcome).toEqual({ kind: "failed", reason: "probe printed more than 64 KiB" });
});

test("probeRuntime caps a real probe's stdout and stderr together with the default spawn", () => {
  const outcome = probeRuntime(
    [
      process.execPath,
      "-e",
      'process.stdout.write(\'{"ok": true, "runtime": "cpython", "version": "3.12.4"}\\n\'); ' +
        "process.stderr.write('x'.repeat(65500))",
      "--",
    ],
    [],
  );

  expect(outcome).toEqual({ kind: "failed", reason: "probe printed more than 64 KiB" });
});

test("probeRuntime reports a real missing executable as unstartable with the default spawn", () => {
  const outcome = probeRuntime(["/nonexistent/docbridge-runtime"], []);

  expect(outcome.kind).toBe("unstartable");
});

test("spawnRuntimeProbe stops a runtime that ignores SIGTERM at the time limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-probe-term-"));
  try {
    const runtime = join(dir, "stubborn-runtime");
    writeFileSync(runtime, "#!/bin/sh\ntrap '' TERM\nsleep 3\n");
    chmodSync(runtime, 0o755);

    const started = Date.now();
    const result = spawnRuntimeProbe(runtime, ["--probe"], {
      env: workerProcessEnv(),
      timeout: 200,
      maxBuffer: 64 * 1024,
    });

    expect(Date.now() - started).toBeLessThan(1_500);
    expect((result.error as { code?: unknown } | undefined)?.code).toBe("ETIMEDOUT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const OK_PROBE_LINE = '{"ok": true, "runtime": "cpython", "version": "3.12.4"}';

test("probeRuntimeAsync runs the command with --probe and empty stdin, bounded to 10 s and 64 KiB", async () => {
  const inputs: Parameters<ScannerWorkerRunAsync>[0][] = [];
  const runAsync: ScannerWorkerRunAsync = (input) => {
    inputs.push(input);
    return settledCancelable<ScannerWorkerProcessResult>({
      ok: true,
      exitCode: 0,
      stdout: `${OK_PROBE_LINE}\n`,
      stderr: "",
    });
  };

  const outcome = await probeRuntimeAsync(
    ["py", "-3", "-I", "-S", "/opt/docbridge/scanner.py"],
    ["PYTHONPATH"],
    runAsync,
  ).promise;

  expect(inputs).toEqual([
    {
      command: ["py", "-3", "-I", "-S", "/opt/docbridge/scanner.py", "--probe"],
      stdin: "",
      stripEnv: ["PYTHONPATH"],
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    },
  ]);
  expect(outcome).toEqual({ kind: "ok", runtime: "cpython", version: "3.12.4" });
});

test.each([
  ["an ok probe", ["sh", "-c", `printf '%s\\n' '${OK_PROBE_LINE}'`, "--"]],
  ["a rejection", ["sh", "-c", `printf '%s\\n' '{"ok": false, "reason": "found PyPy"}'`, "--"]],
  ["an unsuccessful exit", ["sh", "-c", "echo 'cannot load json' >&2; exit 1", "--"]],
  ["a kill by a signal", ["sh", "-c", "kill -KILL $$", "--"]],
  ["malformed output", ["sh", "-c", "echo Python 3.12.4", "--"]],
  ["stdout over 64 KiB", [process.execPath, "-e", "process.stdout.write('x'.repeat(70000))", "--"]],
  [
    "stdout and stderr together over 64 KiB",
    [
      process.execPath,
      "-e",
      `process.stdout.write('${OK_PROBE_LINE}\\n'); process.stderr.write('x'.repeat(65500))`,
      "--",
    ],
  ],
])("probeRuntimeAsync classifies %s as probeRuntime does", async (_label, command) => {
  const expected = probeRuntime(command, []);

  const outcome = await probeRuntimeAsync(command, []).promise;

  expect(outcome).toEqual(expected);
});

test("probeRuntimeAsync reports a missing executable as unstartable", async () => {
  const outcome = await probeRuntimeAsync(["/nonexistent/docbridge-runtime"], []).promise;

  expect(outcome.kind).toBe("unstartable");
});

/** The real asynchronous runner with a 100 ms time limit in place of the probe's 10 s. */
const runWithShortLimit: ScannerWorkerRunAsync = (input) =>
  runScannerWorkerProcessAsync({ ...input, timeoutMs: 100 });

test("probeRuntimeAsync reports a probe that outlives the time limit as failed", async () => {
  const outcome = await probeRuntimeAsync(["sh", "-c", "exec sleep 5", "--"], [], runWithShortLimit)
    .promise;

  expect(outcome).toEqual({ kind: "failed", reason: "probe did not finish within 10 s" });
});

test("probeRuntimeAsync starts the probe without the stripped variables", async () => {
  process.env.DOCBRIDGE_TEST_PROBE_INJECTED = "injected";
  try {
    const outcome = await probeRuntimeAsync(
      [
        "sh",
        "-c",
        'printf \'{"ok": false, "reason": "%s"}\\n\' "${DOCBRIDGE_TEST_PROBE_INJECTED-unset}"',
        "--",
      ],
      ["DOCBRIDGE_TEST_PROBE_INJECTED"],
    ).promise;

    expect(outcome).toEqual({ kind: "rejected", reason: "unset" });
  } finally {
    delete process.env.DOCBRIDGE_TEST_PROBE_INJECTED;
  }
});

test("a pending timer fires while an asynchronous probe runs", async () => {
  const events: string[] = [];
  const probe = probeRuntimeAsync(
    ["sh", "-c", `sleep 0.5; printf '%s\\n' '${OK_PROBE_LINE}'`, "--"],
    [],
  );
  setTimeout(() => events.push("timer"), 10);

  const outcome = await probe.promise;
  events.push("probe");

  expect(events).toEqual(["timer", "probe"]);
  expect(outcome.kind).toBe("ok");
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

test("cancelling an asynchronous probe kills the runtime and what it started, and rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-probe-cancel-"));
  try {
    const pidFile = join(dir, "pid");
    const probe = probeRuntimeAsync(
      [
        "sh",
        "-c",
        `sleep 30 & echo $! > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'; wait`,
        "--",
      ],
      [],
    );
    await eventually(() => existsSync(pidFile));
    const descendant = Number(readFileSync(pidFile, "utf8").trim());
    expect(isAlive(descendant)).toBe(true);

    probe.cancel();

    expect(isAbortError(await probe.promise.catch((reason: unknown) => reason))).toBe(true);
    await eventually(() => !isAlive(descendant), 1_500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
