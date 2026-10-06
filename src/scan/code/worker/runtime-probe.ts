import type { Cancelable } from "../../../shared/cancelable";
import { reasonOf } from "../../../shared/error";
import {
  runScannerWorkerProcess,
  type ScannerWorkerProcessResult,
  type ScannerWorkerRun,
} from "./scanner-worker";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

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
 * gets, bounded in time and output, and classify what it printed. The runner
 * starts the probe in its own process group on POSIX systems and kills the
 * group with `SIGKILL` at limits or cancellation.
 */
export function probeRuntime(
  command: readonly string[],
  stripEnv: readonly string[],
  run: ScannerWorkerRun = runScannerWorkerProcess,
): Cancelable<RuntimeProbeOutcome> {
  const task = run({
    command: [...command, "--probe"],
    stdin: "",
    stripEnv,
    timeoutMs: PROBE_TIMEOUT_MS,
    maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
  });
  return {
    promise: task.promise.then(classifyProbe),
    cancel: () => task.cancel(),
  };
}

function classifyProbe(result: ScannerWorkerProcessResult): RuntimeProbeOutcome {
  if (result.ok) {
    if (result.exitCode !== 0) {
      const detail = firstLine(result.stderr);
      return {
        kind: "failed",
        reason: `probe exited with status ${result.exitCode}${detail === "" ? "" : `: ${detail}`}`,
      };
    }
    return parseProbeOutput(result.stdout);
  }
  switch (result.cause?.type) {
    case "timeout":
      return { kind: "failed", reason: `probe did not finish within ${PROBE_TIMEOUT_MS / 1000} s` };
    case "output-limit":
      return {
        kind: "failed",
        reason: `probe printed more than ${PROBE_MAX_OUTPUT_BYTES / 1024} KiB`,
      };
    case "signal":
      return { kind: "failed", reason: `probe terminated by signal ${result.cause.signal}` };
    default:
      return { kind: "unstartable", reason: reasonOf(result.error) };
  }
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
