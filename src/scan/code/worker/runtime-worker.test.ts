import { beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  abortError,
  isAbortError,
  settledCancelable,
  type Cancelable,
} from "../../../shared/cancelable";
import type { RuntimeProbeOutcome } from "./runtime-probe";
import { clearRuntimeProbeCache, resolveRuntimeWorkerCommand } from "./runtime-worker";

const PYTHON_ENTRY = "packages/python-scanner/docbridge_python_scanner.py";
const RUBY_ENTRY = "packages/ruby-scanner/bin/docbridge-ruby-scanner";
const JAVA_ENTRY = "packages/java-scanner/build/docbridge-java-scanner.jar";

const PYTHON_OK: RuntimeProbeOutcome = { kind: "ok", runtime: "cpython", version: "3.12.4" };

beforeEach(() => {
  clearRuntimeProbeCache();
});

/** A package root holding the given files, standing in for a checkout or an install. */
async function withPackage(files: string[], run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "docbridge-runtime-worker-"));
  try {
    for (const relPath of files) {
      mkdirSync(join(root, relPath, ".."), { recursive: true });
      writeFileSync(join(root, relPath), "");
    }
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A probe that settles at once per runtime executable, recording every command it sees. */
function fakeProbe(outcomes: Record<string, RuntimeProbeOutcome>) {
  const calls: string[][] = [];
  const probe = (command: readonly string[]): Cancelable<RuntimeProbeOutcome> => {
    calls.push([...command]);
    return settledCancelable(
      outcomes[command[0] ?? ""] ?? {
        kind: "unstartable",
        reason: `spawn ${command[0]} ENOENT`,
      },
    );
  };
  return { calls, probe };
}

test("resolveRuntimeWorkerCommand runs a usable python3 isolated on the bundled entrypoint", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { probe } = fakeProbe({ python3: PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "linux",
      probe,
    }).promise;

    expect(result).toEqual({
      ok: true,
      command: ["python3", "-I", "-S", join(root, PYTHON_ENTRY)],
      stripEnv: ["PYTHONPATH", "PYTHONSTARTUP", "PYTHONHOME", "PYTHONSAFEPATH"],
      runtime: ["cpython", "3.12.4", "python3"],
    });
  });
});

test("resolveRuntimeWorkerCommand runs Ruby without RubyGems on the bundled script", async () => {
  await withPackage([RUBY_ENTRY], async (root) => {
    const { probe } = fakeProbe({
      ruby: { kind: "ok", runtime: "cruby", version: "3.3.6" },
    });

    const result = await resolveRuntimeWorkerCommand("ruby", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      probe,
    }).promise;

    expect(result).toEqual({
      ok: true,
      command: [
        "ruby",
        "--disable=gems,did_you_mean,error_highlight",
        "-W0",
        join(root, RUBY_ENTRY),
      ],
      stripEnv: ["RUBYOPT", "RUBYLIB", "PRISM_FFI_BACKEND"],
      runtime: ["cruby", "3.3.6", "ruby"],
    });
  });
});

test("resolveRuntimeWorkerCommand runs Java with start-up flags on the bundled JAR", async () => {
  await withPackage([JAVA_ENTRY], async (root) => {
    const { probe } = fakeProbe({ java: { kind: "ok", runtime: "jdk", version: "17.0.19" } });

    const result = await resolveRuntimeWorkerCommand("java", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      probe,
    }).promise;

    expect(result).toEqual({
      ok: true,
      command: [
        "java",
        "-Xshare:auto",
        "-XX:TieredStopAtLevel=1",
        "-XX:+UseSerialGC",
        "-jar",
        join(root, JAVA_ENTRY),
      ],
      stripEnv: ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"],
      runtime: ["jdk", "17.0.19", "java"],
    });
  });
});

test("resolveRuntimeWorkerCommand identifies the runtime by its probe and the executable PATH finds", async () => {
  const installs = ["opt/a/bin/python3", "opt/b/bin/python3"];
  await withPackage([PYTHON_ENTRY, ...installs], async (root) => {
    for (const install of installs) {
      chmodSync(join(root, install), 0o755);
    }
    const { probe } = fakeProbe({ python3: PYTHON_OK });
    const resolveOn = (path: string) =>
      resolveRuntimeWorkerCommand("python", {
        projectRoot: "/project",
        sourceRoot: root,
        env: { PATH: path },
        platform: "linux",
        probe,
      }).promise;

    const first = await resolveOn(
      [join(root, "missing"), join(root, "opt/a/bin"), join(root, "opt/b/bin")].join(":"),
    );
    const second = await resolveOn(join(root, "opt/b/bin"));

    expect(first).toMatchObject({
      ok: true,
      command: ["python3", "-I", "-S", join(root, PYTHON_ENTRY)],
      runtime: ["cpython", "3.12.4", realpathSync(join(root, "opt/a/bin/python3"))],
    });
    expect(second).toMatchObject({
      ok: true,
      command: ["python3", "-I", "-S", join(root, PYTHON_ENTRY)],
      runtime: ["cpython", "3.12.4", realpathSync(join(root, "opt/b/bin/python3"))],
    });
  });
});

test("resolveRuntimeWorkerCommand uses the npm package entrypoint without a source checkout", async () => {
  await withPackage(["dist/workers/python/docbridge_python_scanner.py"], async (root) => {
    const { probe } = fakeProbe({ python3: PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      distRoot: join(root, "dist"),
      env: {},
      platform: "linux",
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: [
        "python3",
        "-I",
        "-S",
        join(root, "dist/workers/python/docbridge_python_scanner.py"),
      ],
    });
  });
});

test("resolveRuntimeWorkerCommand reports a missing bundled worker without probing", async () => {
  await withPackage([], async (root) => {
    const { calls, probe } = fakeProbe({
      java: { kind: "ok", runtime: "jdk", version: "21" },
    });

    const result = await resolveRuntimeWorkerCommand("java", {
      projectRoot: "/project",
      sourceRoot: root,
      distRoot: join(root, "dist"),
      env: {},
      probe,
    }).promise;

    expect(calls).toEqual([]);
    expect(result).toEqual({
      ok: false,
      diagnostic: {
        severity: "error",
        code: "code_scanner_unavailable",
        language: "java",
        target: "java",
        message:
          `Java scanner worker is unavailable: the bundled worker is missing; looked for ` +
          `${join(root, JAVA_ENTRY)} and ${join(root, "dist/workers/java/docbridge-java-scanner.jar")}; ` +
          "run `just build-java-scanner` in a source checkout",
      },
    });
  });
});

test("a Ruby resolution failure carries the ruby language", async () => {
  await withPackage([RUBY_ENTRY], async (root) => {
    const { probe } = fakeProbe({ ruby: { kind: "ok", runtime: "cruby", version: "3.2.4" } });

    const result = await resolveRuntimeWorkerCommand("ruby", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "code_scanner_unavailable", language: "ruby", target: "ruby" },
    });
  });
});

test("resolveRuntimeWorkerCommand prefers the configured command over the variable and candidates", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({
      py: PYTHON_OK,
      "/env/python3": PYTHON_OK,
      python3: PYTHON_OK,
    });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      command: ["py", "-3.12"],
      env: { DOCBRIDGE_PYTHON_RUNTIME: "/env/python3" },
      platform: "linux",
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: ["py", "-3.12", "-I", "-S", join(root, PYTHON_ENTRY)],
    });
    expect(calls).toHaveLength(1);
  });
});

test("resolveRuntimeWorkerCommand resolves a relative configured executable against the project root", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const projectRoot = join(root, "project");
    const { probe } = fakeProbe({ [join(projectRoot, ".venv/bin/python")]: PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot,
      sourceRoot: root,
      command: [".venv/bin/python"],
      env: {},
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: [join(projectRoot, ".venv/bin/python"), "-I", "-S", join(root, PYTHON_ENTRY)],
    });
  });
});

test("resolveRuntimeWorkerCommand looks up a bare configured executable name on PATH", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { probe } = fakeProbe({ "python3.12": PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: join(root, "project"),
      sourceRoot: root,
      command: ["python3.12"],
      env: {},
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: ["python3.12", "-I", "-S", join(root, PYTHON_ENTRY)],
    });
  });
});

test("resolveRuntimeWorkerCommand reports a configured command that cannot start, without fallback", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      command: ["/opt/py/bin/python3"],
      env: {},
      platform: "linux",
      probe,
    }).promise;

    expect(calls.map((command) => command[0])).toEqual(["/opt/py/bin/python3"]);
    expect(result).toEqual({
      ok: false,
      diagnostic: {
        severity: "error",
        code: "code_scanner_unavailable",
        language: "python",
        target: "python",
        message:
          "Python scanner worker is unavailable: scanners.python.command (/opt/py/bin/python3) " +
          "could not be started: spawn /opt/py/bin/python3 ENOENT; no other runtime is " +
          "tried while scanners.python.command is set",
      },
    });
  });
});

test("resolveRuntimeWorkerCommand reports a configured command whose probe crashes as failed", async () => {
  await withPackage([RUBY_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({
      "/opt/ruby/bin/ruby": { kind: "failed", reason: "probe exited with status 1" },
      ruby: { kind: "ok", runtime: "cruby", version: "3.4.9" },
    });

    const result = await resolveRuntimeWorkerCommand("ruby", {
      projectRoot: "/project",
      sourceRoot: root,
      command: ["/opt/ruby/bin/ruby"],
      env: {},
      probe,
    }).promise;

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "code_scanner_failed",
        message:
          "Ruby scanner worker failed: scanners.ruby.command (/opt/ruby/bin/ruby) failed its " +
          "probe: probe exited with status 1; no other runtime is tried while " +
          "scanners.ruby.command is set",
      },
    });
  });
});

test("resolveRuntimeWorkerCommand uses DOCBRIDGE_<LANGUAGE>_RUNTIME when no command is configured", async () => {
  await withPackage([JAVA_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({
      "/opt/jdk/bin/java": { kind: "ok", runtime: "jdk", version: "21.0.5" },
      java: { kind: "ok", runtime: "jdk", version: "17.0.19" },
    });

    const result = await resolveRuntimeWorkerCommand("java", {
      projectRoot: "/project",
      sourceRoot: root,
      env: { DOCBRIDGE_JAVA_RUNTIME: "/opt/jdk/bin/java" },
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: [
        "/opt/jdk/bin/java",
        "-Xshare:auto",
        "-XX:TieredStopAtLevel=1",
        "-XX:+UseSerialGC",
        "-jar",
        join(root, JAVA_ENTRY),
      ],
    });
    expect(calls).toHaveLength(1);
  });
});

test("resolveRuntimeWorkerCommand reports a failing environment override without fallback", async () => {
  await withPackage([JAVA_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({
      "/opt/jre/bin/java": {
        kind: "rejected",
        reason: "the Java runtime at /opt/jre has no jdk.compiler module",
      },
      java: { kind: "ok", runtime: "jdk", version: "17.0.19" },
    });

    const result = await resolveRuntimeWorkerCommand("java", {
      projectRoot: "/project",
      sourceRoot: root,
      env: { DOCBRIDGE_JAVA_RUNTIME: "/opt/jre/bin/java" },
      probe,
    }).promise;

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "code_scanner_unavailable",
        message:
          "Java scanner worker is unavailable: DOCBRIDGE_JAVA_RUNTIME (/opt/jre/bin/java) is not " +
          "a usable JDK 17 or later: the Java runtime at /opt/jre has no jdk.compiler module; " +
          "no other runtime is tried while DOCBRIDGE_JAVA_RUNTIME is set",
      },
    });
  });
});

test("resolveRuntimeWorkerCommand treats an empty environment override as unset", async () => {
  await withPackage([RUBY_ENTRY], async (root) => {
    const { probe } = fakeProbe({ ruby: { kind: "ok", runtime: "cruby", version: "3.4.9" } });

    const result = await resolveRuntimeWorkerCommand("ruby", {
      projectRoot: "/project",
      sourceRoot: root,
      env: { DOCBRIDGE_RUBY_RUNTIME: "" },
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: true,
      command: [
        "ruby",
        "--disable=gems,did_you_mean,error_highlight",
        "-W0",
        join(root, RUBY_ENTRY),
      ],
    });
  });
});

test.each<[string, RuntimeProbeOutcome]>([
  ["missing", { kind: "unstartable", reason: "spawn python3 ENOENT" }],
  ["below the floor", { kind: "rejected", reason: "CPython 3.9.18 is below the 3.10 floor" }],
  ["crashing", { kind: "failed", reason: "probe exited with status 1" }],
])(
  "resolveRuntimeWorkerCommand falls through to python when python3 is %s",
  async (_label, outcome) => {
    await withPackage([PYTHON_ENTRY], async (root) => {
      const { calls, probe } = fakeProbe({ python3: outcome, python: PYTHON_OK });

      const result = await resolveRuntimeWorkerCommand("python", {
        projectRoot: "/project",
        sourceRoot: root,
        env: {},
        platform: "darwin",
        probe,
      }).promise;

      expect(calls.map((command) => command[0])).toEqual(["python3", "python"]);
      expect(result).toMatchObject({
        ok: true,
        command: ["python", "-I", "-S", join(root, PYTHON_ENTRY)],
      });
    });
  },
);

test("resolveRuntimeWorkerCommand tries the py -3 launcher before python on Windows", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({ python: PYTHON_OK });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "win32",
      probe,
    }).promise;

    expect(calls).toEqual([
      ["py", "-3", "-I", "-S", join(root, PYTHON_ENTRY)],
      ["python", "-I", "-S", join(root, PYTHON_ENTRY)],
    ]);
    expect(result).toMatchObject({
      ok: true,
      command: ["python", "-I", "-S", join(root, PYTHON_ENTRY)],
    });
  });
});

test("resolveRuntimeWorkerCommand names the runtime, floor, and every candidate when none is found", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { probe } = fakeProbe({});

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "linux",
      probe,
    }).promise;

    expect(result).toEqual({
      ok: false,
      diagnostic: {
        severity: "error",
        code: "code_scanner_unavailable",
        language: "python",
        target: "python",
        message:
          "Python scanner worker is unavailable: no usable CPython 3.10 or later found: python3 " +
          "could not be started: spawn python3 ENOENT; python could not be started: " +
          "spawn python ENOENT. Install CPython 3.10 or later, or set " +
          "scanners.python.command or DOCBRIDGE_PYTHON_RUNTIME",
      },
    });
  });
});

test("resolveRuntimeWorkerCommand reports the first found candidate's probe crash as failed", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { probe } = fakeProbe({
      python3: { kind: "failed", reason: "probe did not finish within 10 s" },
    });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "linux",
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "code_scanner_failed",
        message: expect.stringContaining(
          "Python scanner worker failed: no usable CPython 3.10 or later found: python3 failed " +
            "its probe: probe did not finish within 10 s; python could not be started",
        ),
      },
    });
  });
});

test.each<[string, RuntimeProbeOutcome, string]>([
  [
    "a version below the floor",
    { kind: "ok", runtime: "cpython", version: "3.9.18" },
    "is CPython 3.9.18, below the 3.10 floor",
  ],
  [
    "another runtime",
    { kind: "ok", runtime: "pypy", version: "3.10.14" },
    "reports runtime pypy 3.10.14, not CPython",
  ],
])(
  "resolveRuntimeWorkerCommand rejects an ok probe that reports %s",
  async (_label, outcome, reason) => {
    await withPackage([PYTHON_ENTRY], async (root) => {
      const { probe } = fakeProbe({ "/opt/py/bin/python3": outcome });

      const result = await resolveRuntimeWorkerCommand("python", {
        projectRoot: "/project",
        sourceRoot: root,
        command: ["/opt/py/bin/python3"],
        env: {},
        probe,
      }).promise;

      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: "code_scanner_unavailable",
          message: expect.stringContaining(
            `scanners.python.command (/opt/py/bin/python3) ${reason};`,
          ),
        },
      });
    });
  },
);

test("resolveRuntimeWorkerCommand reports an unreadable probe version as failed", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { probe } = fakeProbe({
      "/opt/py/bin/python3": { kind: "ok", runtime: "cpython", version: "unknown" },
    });

    const result = await resolveRuntimeWorkerCommand("python", {
      projectRoot: "/project",
      sourceRoot: root,
      command: ["/opt/py/bin/python3"],
      env: {},
      probe,
    }).promise;

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "code_scanner_failed",
        message: expect.stringContaining("reported an unreadable version: unknown"),
      },
    });
  });
});

test.each([
  ["1.8.0_392", false],
  ["16.0.2", false],
  ["17", true],
  ["21.0.5", true],
])("resolveRuntimeWorkerCommand applies the JDK 17 floor to Java %s", async (version, usable) => {
  await withPackage([JAVA_ENTRY], async (root) => {
    const { probe } = fakeProbe({ java: { kind: "ok", runtime: "jdk", version } });

    const result = await resolveRuntimeWorkerCommand("java", {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      probe,
    }).promise;

    expect(result.ok).toBe(usable);
  });
});

test("resolveRuntimeWorkerCommand probes a command once for the same PATH and DOCBRIDGE_ values", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });
    const options = {
      projectRoot: "/project",
      sourceRoot: root,
      env: { PATH: "/usr/bin", DOCBRIDGE_UNRELATED: "1", HOME: "/home/a" },
      platform: "linux" as const,
      probe,
    };

    await resolveRuntimeWorkerCommand("python", options).promise;
    await resolveRuntimeWorkerCommand("python", {
      ...options,
      env: { ...options.env, HOME: "/home/b" },
    }).promise;

    expect(calls).toHaveLength(1);
  });
});

test.each([
  ["PATH", { PATH: "/opt/bin:/usr/bin" }],
  ["a DOCBRIDGE_ variable", { DOCBRIDGE_UNRELATED: "2" }],
])("resolveRuntimeWorkerCommand probes again when %s changes", async (_label, change) => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });
    const env = { PATH: "/usr/bin", DOCBRIDGE_UNRELATED: "1" };
    const options = {
      projectRoot: "/project",
      sourceRoot: root,
      platform: "linux" as const,
      probe,
    };

    await resolveRuntimeWorkerCommand("python", { ...options, env }).promise;
    await resolveRuntimeWorkerCommand("python", { ...options, env: { ...env, ...change } }).promise;

    expect(calls).toHaveLength(2);
  });
});

test("resolveRuntimeWorkerCommand probes again after the probe cache is cleared", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });
    const options = {
      projectRoot: "/project",
      sourceRoot: root,
      env: { PATH: "/usr/bin" },
      platform: "linux" as const,
      probe,
    };

    await resolveRuntimeWorkerCommand("python", options).promise;
    clearRuntimeProbeCache();
    await resolveRuntimeWorkerCommand("python", options).promise;

    expect(calls).toHaveLength(2);
  });
});

test("cancelling resolveRuntimeWorkerCommand cancels the probe in flight and caches nothing", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const options = {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "linux" as const,
    };
    const pending = Promise.withResolvers<RuntimeProbeOutcome>();
    let cancelled = 0;
    const task = resolveRuntimeWorkerCommand("python", {
      ...options,
      probe: () => ({
        promise: pending.promise,
        cancel: () => {
          cancelled += 1;
          pending.reject(abortError());
        },
      }),
    });

    task.cancel();

    expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
    expect(cancelled).toBe(1);
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });
    await resolveRuntimeWorkerCommand("python", { ...options, probe }).promise;
    expect(calls).toHaveLength(1);
  });
});

test("an asynchronous probe that finishes after the cache is cleared does not refill it", async () => {
  await withPackage([PYTHON_ENTRY], async (root) => {
    const options = {
      projectRoot: "/project",
      sourceRoot: root,
      env: {},
      platform: "linux" as const,
    };
    const pending = Promise.withResolvers<RuntimeProbeOutcome>();
    const task = resolveRuntimeWorkerCommand("python", {
      ...options,
      probe: () => ({ promise: pending.promise, cancel: () => undefined }),
    });

    clearRuntimeProbeCache();
    pending.resolve({ kind: "ok", runtime: "cpython", version: "3.10.0" });
    await task.promise;
    const { calls, probe } = fakeProbe({ python3: PYTHON_OK });
    const result = await resolveRuntimeWorkerCommand("python", { ...options, probe }).promise;

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, runtime: ["cpython", "3.12.4", "python3"] });
  });
});
