import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import commonOutputSchema from "../../../../schemas/common-output.schema.json";
import scannerWorkerSchema from "../../../../schemas/scanner-worker.schema.json";
import type { CodeScanResult } from "../../../model/scan-result";
import type { CodeLanguage, DocBridgeDiagnostic } from "../../../model/types";
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
};

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
  const processResult = run({
    command,
    stdin: JSON.stringify(request),
    stripEnv,
  });

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

/**
 * Default worker process runner. Spawns via `node:child_process` so the
 * bundled CLI runs under both Node.js and Bun. `maxBuffer` must exceed Node's
 * 1 MiB default because worker responses embed scanned file contents.
 */
export function runScannerWorkerProcess(
  input: ScannerWorkerProcessInput,
): ScannerWorkerProcessResult {
  try {
    const [executable = "", ...args] = input.command;
    const result = spawnSync(executable, args, {
      env: workerProcessEnv(input.stripEnv),
      input: input.stdin,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    });
    const stderr = result.stderr ?? "";
    if (result.error !== undefined) {
      return { ok: false, kind: "start", error: result.error, stderr };
    }
    if (result.status === null) {
      return {
        ok: false,
        kind: "execution",
        error: new Error(`worker terminated by signal ${result.signal ?? "unknown"}`),
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
