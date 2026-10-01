import { spawnSync } from "node:child_process";

import { reasonOf } from "../../../shared/error";
import { workerProcessEnv } from "./scanner-worker";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

type RuntimeProbeSpawnOptions = {
  env: Record<string, string>;
  timeout: number;
  maxBuffer: number;
};

/** The parts of a finished probe process that classify its outcome. */
export type RuntimeProbeSpawnResult = {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

/**
 * Seam for starting a probe process. Tests inject a fake because a real
 * timeout or crash needs a misbehaving runtime on the machine.
 */
export type RuntimeProbeSpawn = (
  executable: string,
  args: string[],
  options: RuntimeProbeSpawnOptions,
) => RuntimeProbeSpawnResult;

/**
 * What a runtime-backed worker's `--probe` revealed: a usable runtime, a
 * runtime that rejected itself (`ok: false`), a command that could not be
 * started, or a probe that crashed, timed out, or printed malformed output.
 */
export type RuntimeProbeOutcome =
  | { kind: "ok"; runtime: string; version: string }
  | { kind: "rejected"; reason: string }
  | { kind: "unstartable"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Run a worker command with `--probe` in the environment the worker itself
 * gets, bounded in time and output, and classify what it printed.
 */
export function probeRuntime(
  command: readonly string[],
  stripEnv: readonly string[],
  spawn: RuntimeProbeSpawn = spawnProbe,
): RuntimeProbeOutcome {
  const [executable = "", ...args] = command;
  const result = spawn(executable, [...args, "--probe"], {
    env: workerProcessEnv(stripEnv),
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_OUTPUT_BYTES,
  });
  if (result.error !== undefined) {
    return classifySpawnError(result.error);
  }
  if (result.status === null) {
    return { kind: "failed", reason: `probe terminated by signal ${result.signal ?? "unknown"}` };
  }
  if (result.status !== 0) {
    const detail = firstLine(result.stderr);
    return {
      kind: "failed",
      reason: `probe exited with status ${result.status}${detail === "" ? "" : `: ${detail}`}`,
    };
  }
  return parseProbeOutput(result.stdout);
}

function classifySpawnError(error: Error): RuntimeProbeOutcome {
  const code = (error as { code?: unknown }).code;
  if (code === "ETIMEDOUT") {
    return { kind: "failed", reason: `probe did not finish within ${PROBE_TIMEOUT_MS / 1000} s` };
  }
  if (code === "ENOBUFS") {
    return {
      kind: "failed",
      reason: `probe printed more than ${PROBE_MAX_OUTPUT_BYTES / 1024} KiB`,
    };
  }
  return { kind: "unstartable", reason: reasonOf(error) };
}

function parseProbeOutput(stdout: string): RuntimeProbeOutcome {
  const text = stdout.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return malformed(text);
  }
  if (!isRecord(value)) {
    return malformed(text);
  }
  if (value.ok === true && typeof value.runtime === "string" && typeof value.version === "string") {
    return { kind: "ok", runtime: value.runtime, version: value.version };
  }
  if (value.ok === false && typeof value.reason === "string") {
    return { kind: "rejected", reason: value.reason };
  }
  return malformed(text);
}

function malformed(text: string): RuntimeProbeOutcome {
  const shown = text.length > 200 ? `${text.slice(0, 200)}...` : text;
  return { kind: "failed", reason: `malformed probe output: ${JSON.stringify(shown)}` };
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/u)[0] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function spawnProbe(
  executable: string,
  args: string[],
  options: RuntimeProbeSpawnOptions,
): RuntimeProbeSpawnResult {
  try {
    const result = spawnSync(executable, args, {
      env: options.env,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      // An empty stdin keeps a runtime that ignores `--probe` from waiting on input.
      input: "",
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  } catch (error) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
