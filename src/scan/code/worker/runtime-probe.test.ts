import { expect, test } from "bun:test";

import {
  probeRuntime,
  type RuntimeProbeSpawn,
  type RuntimeProbeSpawnResult,
} from "./runtime-probe";

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

test("probeRuntime reports a real missing executable as unstartable with the default spawn", () => {
  const outcome = probeRuntime(["/nonexistent/docbridge-runtime"], []);

  expect(outcome.kind).toBe("unstartable");
});
