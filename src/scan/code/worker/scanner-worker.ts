import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import commonOutputSchema from "../../../../schemas/common-output.schema.json";
import scannerWorkerSchema from "../../../../schemas/scanner-worker.schema.json";
import type { CodeScanResult } from "../../../model/scan-result";
import type { CodeLanguage, DocBridgeDiagnostic } from "../../../model/types";
import { abortError, deferred, type Cancelable } from "../../../shared/cancelable";
import { reasonOf } from "../../../shared/error";
import type { CodeScanOptions } from "../adapter";

type ScannerWorkerFile = {
  filePath: string;
  content: string;
};

export type ScannerWorkerRequest = {
  schemaVersion: 1;
  requestId: string;
  language: CodeLanguage;
  projectRoot: string;
  files: ScannerWorkerFile[];
  options: CodeScanOptions;
};

type ScannerWorkerResponse = {
  schemaVersion: 1;
  requestId: string;
  language: CodeLanguage;
  files: ScannerWorkerResponseFile[];
};

type ScannerWorkerResponseFile = Omit<CodeScanResult, "language">;

type ScannerWorkerProcessInput = {
  command: string[];
  stdin: string;
  /**
   * Environment variables removed before the worker starts. Runtime-backed
   * workers name the variables that can load code or options into their
   * interpreter before the bundled entrypoint runs.
   */
  stripEnv?: readonly string[];
  /** Milliseconds before the worker is killed; no limit when omitted. */
  timeoutMs?: number;
  /** Bytes each of stdout and stderr may carry; defaults to 1 GiB. */
  maxOutputBytes?: number;
};

/**
 * The default cap on each output stream. It must exceed Node's 1 MiB default
 * because worker responses embed scanned file contents.
 */
const WORKER_OUTPUT_LIMIT_BYTES = 1024 * 1024 * 1024;

/**
 * How long a killed worker's output may stay open, held by a process the kill
 * did not reach, before the asynchronous runner closes it and settles.
 */
const KILLED_WORKER_GRACE_MS = 500;

export type ScannerWorkerProcessResult =
  | {
      ok: true;
      exitCode: number;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      /**
       * Whether the worker never started (`start`, the default) or started and
       * then failed (`execution`): a signal, a timeout, or oversized output.
       */
      kind?: "start" | "execution";
      error: unknown;
      stderr: string;
    };

export type ScannerWorkerRun = (input: ScannerWorkerProcessInput) => ScannerWorkerProcessResult;

export type ScannerWorkerRunAsync = (
  input: ScannerWorkerProcessInput,
) => Cancelable<ScannerWorkerProcessResult>;

type ScannerWorkerSuccess = {
  ok: true;
  codeFiles: CodeScanResult[];
  stderr: string;
};

type ScannerWorkerFailure = {
  ok: false;
  diagnostic: DocBridgeDiagnostic;
  stderr: string;
};

type ScannerWorkerResult = ScannerWorkerSuccess | ScannerWorkerFailure;

/** @internal Exported only to make the lazy initialization contract executable in tests. */
export function createLazyWorkerResponseValidator<T>(compile: () => T): () => T {
  let validator: T | undefined;
  return () => {
    validator ??= compile();
    return validator;
  };
}

const responseValidator = createLazyWorkerResponseValidator(compileWorkerResponseValidator);

function compileWorkerResponseValidator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(commonOutputSchema);
  return ajv.compile({
    $schema: scannerWorkerSchema.$schema,
    $defs: scannerWorkerSchema.$defs,
    $ref: "#/$defs/response",
  });
}

export function invokeScannerWorker(
  request: ScannerWorkerRequest,
  command: string[],
  run: ScannerWorkerRun = runScannerWorkerProcess,
  stripEnv: readonly string[] = [],
): ScannerWorkerResult {
  return interpretWorkerProcess(request, command, run(processInput(request, command, stripEnv)));
}

/**
 * The asynchronous counterpart of {@link invokeScannerWorker}, used by the
 * Language Server. Cancelling it cancels the process run.
 */
export function invokeScannerWorkerAsync(
  request: ScannerWorkerRequest,
  command: string[],
  runAsync: ScannerWorkerRunAsync = runScannerWorkerProcessAsync,
  stripEnv: readonly string[] = [],
): Cancelable<ScannerWorkerResult> {
  const run = runAsync(processInput(request, command, stripEnv));
  return {
    promise: run.promise.then((processResult) =>
      interpretWorkerProcess(request, command, processResult),
    ),
    cancel: () => run.cancel(),
  };
}

function processInput(
  request: ScannerWorkerRequest,
  command: string[],
  stripEnv: readonly string[],
): ScannerWorkerProcessInput {
  return {
    command,
    stdin: JSON.stringify(request),
    stripEnv,
    timeoutMs: workerTimeoutMs(request.files.length),
  };
}

/** Turn a finished worker process into scan results or one failure diagnostic. */
function interpretWorkerProcess(
  request: ScannerWorkerRequest,
  command: string[],
  processResult: ScannerWorkerProcessResult,
): ScannerWorkerResult {
  if (!processResult.ok) {
    return {
      ok: false,
      diagnostic:
        processResult.kind === "execution"
          ? scannerFailedDiagnostic(request.language, reasonOf(processResult.error))
          : scannerUnavailableDiagnostic(request.language, processResult.error, command[0]),
      stderr: processResult.stderr,
    };
  }

  if (processResult.exitCode !== 0) {
    return {
      ok: false,
      diagnostic: scannerFailedDiagnostic(
        request.language,
        `worker exited with status ${processResult.exitCode}`,
      ),
      stderr: processResult.stderr,
    };
  }

  let response: unknown;
  try {
    response = JSON.parse(processResult.stdout);
  } catch (error) {
    return {
      ok: false,
      diagnostic: scannerFailedDiagnostic(request.language, reasonOf(error)),
      stderr: processResult.stderr,
    };
  }

  const validationError = validateWorkerResponse(response, request);
  if (validationError !== undefined) {
    return {
      ok: false,
      diagnostic: scannerFailedDiagnostic(request.language, validationError),
      stderr: processResult.stderr,
    };
  }

  const validResponse = response as ScannerWorkerResponse;
  return {
    ok: true,
    codeFiles: validResponse.files.map((file) => ({
      ...file,
      language: request.language,
    })),
    stderr: processResult.stderr,
  };
}

/**
 * Directory the Swift/clang toolchain may use as its module cache during a
 * worker scan. Rooted in the OS temp dir and scoped per user so concurrent
 * users on a shared host never collide on a directory owned by someone else,
 * and so the path stays valid on platforms without `/tmp`.
 */
export function clangModuleCachePath(): string {
  const owner = typeof process.getuid === "function" ? process.getuid() : "shared";
  return join(tmpdir(), `docbridge-clang-module-cache-${owner}`);
}

/**
 * The environment a worker process starts with: the current environment
 * without the variables in `stripEnv`, plus the clang module cache path the
 * Swift toolchain needs. Every process runner, synchronous or not, uses it.
 */
export function workerProcessEnv(stripEnv: readonly string[] = []): Record<string, string> {
  const moduleCachePath = clangModuleCachePath();
  mkdirSync(moduleCachePath, { recursive: true });
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !stripEnv.includes(name)) {
      env[name] = value;
    }
  }
  env.CLANG_MODULE_CACHE_PATH = moduleCachePath;
  return env;
}

/** The time one worker invocation may take: 30 s plus 1 s per requested file. */
function workerTimeoutMs(fileCount: number): number {
  return 30_000 + 1_000 * fileCount;
}

/**
 * Default worker process runner. Spawns via `node:child_process` so the
 * bundled CLI runs under both Node.js and Bun.
 */
export function runScannerWorkerProcess(
  input: ScannerWorkerProcessInput,
): ScannerWorkerProcessResult {
  const maxOutputBytes = input.maxOutputBytes ?? WORKER_OUTPUT_LIMIT_BYTES;
  try {
    const [executable = "", ...args] = input.command;
    const result = spawnSync(executable, args, {
      env: workerProcessEnv(input.stripEnv),
      input: input.stdin,
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      killSignal: "SIGKILL",
      ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
    });
    const stderr = result.stderr ?? "";
    if (result.error !== undefined) {
      return syncSpawnFailure(result.error, input.timeoutMs, maxOutputBytes, stderr);
    }
    if (result.status === null) {
      return {
        ok: false,
        kind: "execution",
        error: signalError(result.signal),
        stderr,
      };
    }
    return {
      ok: true,
      exitCode: result.status,
      stdout: result.stdout ?? "",
      stderr,
    };
  } catch (error) {
    return { ok: false, kind: "start", error, stderr: "" };
  }
}

/**
 * Asynchronous worker process runner for the Language Server. It spawns with
 * an argv array and no shell, counts each output stream's bytes against the
 * cap, and settles once, after the streams close. The timeout and an oversized
 * stream kill the worker with `SIGKILL` and report an execution failure;
 * cancelling kills it the same way and rejects with an `AbortError`. A killed
 * worker's output streams are closed after {@link KILLED_WORKER_GRACE_MS} even
 * if a process the kill missed still holds them, so the run always settles.
 */
export function runScannerWorkerProcessAsync(
  input: ScannerWorkerProcessInput,
): Cancelable<ScannerWorkerProcessResult> {
  const run = deferred<ScannerWorkerProcessResult>();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const settle = (complete: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    clearTimeout(grace);
    complete();
  };

  const ownGroup = process.platform !== "win32";
  let child: ChildProcessWithoutNullStreams;
  try {
    const [executable = "", ...args] = input.command;
    child = spawn(executable, args, { env: workerProcessEnv(input.stripEnv), detached: ownGroup });
  } catch (error) {
    settle(() => run.resolve({ ok: false, kind: "start", error, stderr: "" }));
    return { promise: run.promise, cancel: () => undefined };
  }

  const maxOutputBytes = input.maxOutputBytes ?? WORKER_OUTPUT_LIMIT_BYTES;
  const stdout = new OutputCollector(maxOutputBytes);
  const stderr = new OutputCollector(maxOutputBytes);
  let failure: Error | undefined;
  const kill = (reason: Error): void => {
    failure ??= reason;
    killWorker(child, ownGroup);
    grace ??= setTimeout(() => {
      closeStreams(child);
      settle(() => run.resolve(closedProcessResult(null, null, failure, stdout, stderr)));
    }, KILLED_WORKER_GRACE_MS);
  };
  let spawned = false;

  child.on("spawn", () => {
    spawned = true;
  });
  child.on("error", (error) => {
    if (!spawned) {
      settle(() => run.resolve({ ok: false, kind: "start", error, stderr: stderr.text() }));
      return;
    }
    failure ??= error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (!stdout.add(chunk)) {
      kill(outputLimitError(maxOutputBytes));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (!stderr.add(chunk)) {
      kill(outputLimitError(maxOutputBytes));
    }
  });
  // A worker may exit without reading its input; its exit status reports why.
  child.stdin.on("error", () => undefined);
  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    settle(() => run.resolve(closedProcessResult(code, signal, failure, stdout, stderr)));
  });
  child.stdin.end(input.stdin);
  const { timeoutMs } = input;
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => kill(timeoutError(timeoutMs)), timeoutMs);
  }

  return {
    promise: run.promise,
    cancel() {
      settle(() => {
        killWorker(child, ownGroup);
        closeStreams(child);
        run.reject(abortError());
      });
    },
  };
}

/**
 * Kill a worker the asynchronous runner started. On POSIX the worker leads its
 * own process group, so killing the group also kills the processes it started,
 * such as the runtime behind a wrapper script. On Windows only the worker
 * itself is killed; a process it started may outlive it.
 */
function killWorker(child: ChildProcessWithoutNullStreams, ownGroup: boolean): void {
  if (ownGroup && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The group is gone already; killing the worker directly is harmless.
    }
  }
  child.kill("SIGKILL");
}

function closeStreams(child: ChildProcessWithoutNullStreams): void {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

/** One output stream collected as bytes and decoded once the stream closes. */
class OutputCollector {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;

  constructor(private readonly limit: number) {}

  /** Keep `chunk`; false once the stream exceeds the cap, after which chunks are dropped. */
  add(chunk: Buffer): boolean {
    this.bytes += chunk.byteLength;
    if (this.bytes > this.limit) {
      return false;
    }
    this.chunks.push(chunk);
    return true;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function closedProcessResult(
  code: number | null,
  signal: NodeJS.Signals | null,
  failure: Error | undefined,
  stdout: OutputCollector,
  stderr: OutputCollector,
): ScannerWorkerProcessResult {
  if (failure !== undefined) {
    return { ok: false, kind: "execution", error: failure, stderr: stderr.text() };
  }
  if (code === null) {
    return { ok: false, kind: "execution", error: signalError(signal), stderr: stderr.text() };
  }
  return { ok: true, exitCode: code, stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * Classify a `spawnSync` error. Node and Bun both report a timeout as
 * `ETIMEDOUT` and an output stream over `maxBuffer` as `ENOBUFS`; the worker
 * ran in both cases. Any other error means it never started.
 */
function syncSpawnFailure(
  error: Error,
  timeoutMs: number | undefined,
  maxOutputBytes: number,
  stderr: string,
): ScannerWorkerProcessResult {
  const code = (error as { code?: unknown }).code;
  if (code === "ETIMEDOUT") {
    return { ok: false, kind: "execution", error: timeoutError(timeoutMs ?? 0), stderr };
  }
  if (code === "ENOBUFS") {
    return { ok: false, kind: "execution", error: outputLimitError(maxOutputBytes), stderr };
  }
  return { ok: false, kind: "start", error, stderr };
}

function signalError(signal: string | null | undefined): Error {
  return new Error(`worker terminated by signal ${signal ?? "unknown"}`);
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`worker timed out after ${timeoutMs} ms`);
}

function outputLimitError(maxOutputBytes: number): Error {
  return new Error(`worker wrote more than ${maxOutputBytes} bytes to stdout or stderr`);
}

function validateWorkerResponse(value: unknown, request: ScannerWorkerRequest): string | undefined {
  const validator = responseValidator();
  if (!validator(value)) {
    return formatSchemaError(validator.errors);
  }
  const response = value as ScannerWorkerResponse;
  if (response.requestId !== request.requestId) {
    return "worker response requestId does not match the request";
  }
  if (response.language !== request.language) {
    return "worker response language does not match the request";
  }
  if (!responseFilesMatchRequest(response.files, request.files)) {
    return "worker response files must match requested files";
  }
  return undefined;
}

function formatSchemaError(errors: ErrorObject[] | null | undefined): string {
  const error = errors?.[0];
  if (error === undefined) {
    return "worker response does not match scanner-worker.schema.json";
  }
  const path = error.instancePath || "/";
  return `worker response does not match scanner-worker.schema.json at ${path}: ${error.message ?? "invalid value"}`;
}

function responseFilesMatchRequest(
  responseFiles: unknown[],
  requestFiles: ScannerWorkerFile[],
): boolean {
  if (responseFiles.length !== requestFiles.length) {
    return false;
  }
  return responseFiles.every((file, index) => {
    if (!isRecord(file)) {
      return false;
    }
    return file.filePath === requestFiles[index]?.filePath;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scannerUnavailableDiagnostic(
  language: CodeLanguage,
  error: unknown,
  executable?: string,
): DocBridgeDiagnostic {
  const label = languageLabel(language);
  return {
    severity: "error",
    code: "code_scanner_unavailable",
    language,
    target: language,
    message: `${label} scanner worker is unavailable: ${spawnFailureReason(error, executable)}`,
  };
}

/**
 * Explain a spawn failure the executable bit cannot account for.
 *
 * Scanner resolution restores the executable bit before spawning, so a
 * permission error here is not about the mode: the filesystem refuses to
 * execute the file at all, which is what a `noexec` mount does. `bunx` caches
 * packages under the OS temp dir, which is `noexec` on some hosts.
 */
function spawnFailureReason(error: unknown, executable?: string): string {
  const reason = reasonOf(error);
  if (!isExecDenied(error) || executable === undefined) {
    return reason;
  }
  return (
    `${reason}; the scanner is executable but ${dirname(executable)} refuses to ` +
    `execute it, which a \`noexec\` mount does. Install DocBridge as a project ` +
    `dependency, or point the installer cache at an exec-capable directory, ` +
    `instead of running through \`bunx\``
  );
}

function isExecDenied(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "EACCES" || code === "EPERM";
}

function scannerFailedDiagnostic(language: CodeLanguage, reason: string): DocBridgeDiagnostic {
  const label = languageLabel(language);
  return {
    severity: "error",
    code: "code_scanner_failed",
    language,
    target: language,
    message: `${label} scanner worker failed: ${reason}`,
  };
}

function languageLabel(language: CodeLanguage): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}
