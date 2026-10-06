import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isAbortError, settledCancelable } from "../../../shared/cancelable";
import { probeRuntime, type RuntimeProbeOutcome } from "./runtime-probe";
import {
  runScannerWorkerProcess,
  type ScannerWorkerProcessResult,
  type ScannerWorkerRun,
} from "./scanner-worker";

/** A runner that settles at once with `result`, standing in for a finished probe process. */
function finished(result: ScannerWorkerProcessResult): ScannerWorkerRun {
  return () => settledCancelable(result);
}

function exited(stdout: string, exitCode = 0, stderr = ""): ScannerWorkerRun {
  return finished({ ok: true, exitCode, stdout, stderr });
}

test("probeRuntime reports the runtime and version an ok probe prints", async () => {
  const outcome = await probeRuntime(
    ["python3"],
    [],
    exited('{"ok": true, "runtime": "cpython", "version": "3.12.4"}\n'),
  ).promise;

  expect(outcome).toEqual({ kind: "ok", runtime: "cpython", version: "3.12.4" });
});

test("probeRuntime reports a probe that answers ok: false as rejected with its reason", async () => {
  const outcome = await probeRuntime(
    ["python3"],
    [],
    exited('{"ok": false, "reason": "expected CPython, found PyPy 3.10.14"}\n'),
  ).promise;

  expect(outcome).toEqual({ kind: "rejected", reason: "expected CPython, found PyPy 3.10.14" });
});

test("probeRuntime reports an executable that cannot be started as unstartable", async () => {
  const outcome = await probeRuntime(
    ["/opt/missing/python3"],
    [],
    finished({
      ok: false,
      kind: "start",
      error: new Error("spawn /opt/missing/python3 ENOENT"),
      stderr: "",
    }),
  ).promise;

  expect(outcome).toEqual({ kind: "unstartable", reason: "spawn /opt/missing/python3 ENOENT" });
});

test("probeRuntime reports a probe that exits unsuccessfully as failed with its stderr", async () => {
  const outcome = await probeRuntime(
    ["ruby"],
    [],
    exited("", 1, "ruby: cannot load such file -- json (LoadError)\n"),
  ).promise;

  expect(outcome).toEqual({
    kind: "failed",
    reason: "probe exited with status 1: ruby: cannot load such file -- json (LoadError)",
  });
});

test("probeRuntime reports a probe killed by a signal as failed", async () => {
  const outcome = await probeRuntime(
    ["java"],
    [],
    finished({
      ok: false,
      kind: "execution",
      cause: { type: "signal", signal: "SIGSEGV" },
      error: new Error("worker terminated by signal SIGSEGV"),
      stderr: "",
    }),
  ).promise;

  expect(outcome).toEqual({ kind: "failed", reason: "probe terminated by signal SIGSEGV" });
});

test("probeRuntime reports a probe that prints more than the output limit as failed", async () => {
  const outcome = await probeRuntime(
    ["python3"],
    [],
    finished({
      ok: false,
      kind: "execution",
      cause: { type: "output-limit" },
      error: new Error("worker wrote more than 65536 bytes to stdout and stderr together"),
      stderr: "",
    }),
  ).promise;

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
])("probeRuntime reports %s as malformed probe output", async (_label, stdout) => {
  const outcome = await probeRuntime(["python3"], [], exited(stdout)).promise;

  expect(outcome.kind).toBe("failed");
  expect(outcome).toMatchObject({ reason: expect.stringContaining("malformed probe output") });
});

const OK_PROBE_LINE = '{"ok": true, "runtime": "cpython", "version": "3.12.4"}';

test("probeRuntime runs the command with --probe and empty stdin, bounded to 10 s and 64 KiB", async () => {
  const inputs: Parameters<ScannerWorkerRun>[0][] = [];
  const run: ScannerWorkerRun = (input) => {
    inputs.push(input);
    return settledCancelable<ScannerWorkerProcessResult>({
      ok: true,
      exitCode: 0,
      stdout: `${OK_PROBE_LINE}\n`,
      stderr: "",
    });
  };

  const outcome = await probeRuntime(
    ["py", "-3", "-I", "-S", "/opt/docbridge/scanner.py"],
    ["PYTHONPATH"],
    run,
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

const OVER_LIMIT: RuntimeProbeOutcome = {
  kind: "failed",
  reason: "probe printed more than 64 KiB",
};

test.each<[string, string[], RuntimeProbeOutcome]>([
  [
    "an ok probe",
    ["sh", "-c", `printf '%s\\n' '${OK_PROBE_LINE}'`, "--"],
    { kind: "ok", runtime: "cpython", version: "3.12.4" },
  ],
  [
    "a rejection",
    ["sh", "-c", `printf '%s\\n' '{"ok": false, "reason": "found PyPy"}'`, "--"],
    { kind: "rejected", reason: "found PyPy" },
  ],
  [
    "an unsuccessful exit",
    ["sh", "-c", "echo 'cannot load json' >&2; exit 1", "--"],
    { kind: "failed", reason: "probe exited with status 1: cannot load json" },
  ],
  [
    "a kill by a signal",
    ["sh", "-c", "kill -KILL $$", "--"],
    { kind: "failed", reason: "probe terminated by signal SIGKILL" },
  ],
  [
    "malformed output",
    ["sh", "-c", "echo Python 3.12.4", "--"],
    { kind: "failed", reason: 'malformed probe output: "Python 3.12.4"' },
  ],
  [
    "stdout over 64 KiB",
    [process.execPath, "-e", "process.stdout.write('x'.repeat(70000))", "--"],
    OVER_LIMIT,
  ],
  [
    "stdout and stderr together over 64 KiB",
    [
      process.execPath,
      "-e",
      `process.stdout.write('${OK_PROBE_LINE}\\n'); process.stderr.write('x'.repeat(65500))`,
      "--",
    ],
    OVER_LIMIT,
  ],
])("probeRuntime classifies %s of a real probe", async (_label, command, expected) => {
  const outcome = await probeRuntime(command, []).promise;

  expect(outcome).toEqual(expected);
});

test("probeRuntime reports a missing executable as unstartable", async () => {
  const outcome = await probeRuntime(["/nonexistent/docbridge-runtime"], []).promise;

  expect(outcome.kind).toBe("unstartable");
});

/** The real asynchronous runner with a 100 ms time limit in place of the probe's 10 s. */
const runWithShortLimit: ScannerWorkerRun = (input) =>
  runScannerWorkerProcess({ ...input, timeoutMs: 100 });

test("probeRuntime reports a probe that outlives the time limit as failed", async () => {
  const outcome = await probeRuntime(["sh", "-c", "exec sleep 5", "--"], [], runWithShortLimit)
    .promise;

  expect(outcome).toEqual({ kind: "failed", reason: "probe did not finish within 10 s" });
});

test("probeRuntime stops a runtime that ignores SIGTERM at the time limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-probe-term-"));
  try {
    const runtime = join(dir, "stubborn-runtime");
    writeFileSync(runtime, "#!/bin/sh\ntrap '' TERM\nsleep 3\n");
    chmodSync(runtime, 0o755);

    const started = Date.now();
    const outcome = await probeRuntime([runtime], [], runWithShortLimit).promise;

    expect(Date.now() - started).toBeLessThan(1_500);
    expect(outcome).toEqual({ kind: "failed", reason: "probe did not finish within 10 s" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeRuntime starts the probe without the stripped variables", async () => {
  process.env.DOCBRIDGE_TEST_PROBE_INJECTED = "injected";
  try {
    const outcome = await probeRuntime(
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
  const probe = probeRuntime(
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
    const probe = probeRuntime(
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
