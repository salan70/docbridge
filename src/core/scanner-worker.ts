import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodeScanOptions, CodeScanResult } from "./code-scanner";
import type { CodeLanguage, DocBridgeDiagnostic } from "./types";

export type ScannerWorkerFile = {
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

export type ScannerWorkerResponse = {
  schemaVersion: 1;
  requestId: string;
  language: CodeLanguage;
  files: ScannerWorkerResponseFile[];
};

export type ScannerWorkerResponseFile = Omit<CodeScanResult, "language">;

export type ScannerWorkerProcessInput = {
  command: string[];
  stdin: string;
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
      error: unknown;
      stderr: string;
    };

export type ScannerWorkerRun = (
  input: ScannerWorkerProcessInput,
) => ScannerWorkerProcessResult;

export type ScannerWorkerSuccess = {
  ok: true;
  codeFiles: CodeScanResult[];
  stderr: string;
};

export type ScannerWorkerFailure = {
  ok: false;
  diagnostic: DocBridgeDiagnostic;
  stderr: string;
};

export type ScannerWorkerResult = ScannerWorkerSuccess | ScannerWorkerFailure;

export function invokeScannerWorker(
  request: ScannerWorkerRequest,
  command: string[],
  run: ScannerWorkerRun = runScannerWorkerProcess,
): ScannerWorkerResult {
  const processResult = run({
    command,
    stdin: JSON.stringify(request),
  });

  if (!processResult.ok) {
    return {
      ok: false,
      diagnostic: scannerUnavailableDiagnostic(request.language, processResult.error),
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
 * Default worker process runner. Spawns via `node:child_process` so the
 * bundled CLI runs under both Node.js and Bun. `maxBuffer` must exceed Node's
 * 1 MiB default because worker responses embed scanned file contents.
 */
export function runScannerWorkerProcess(
  input: ScannerWorkerProcessInput,
): ScannerWorkerProcessResult {
  try {
    const moduleCachePath = clangModuleCachePath();
    mkdirSync(moduleCachePath, { recursive: true });
    const [executable = "", ...args] = input.command;
    const result = spawnSync(executable, args, {
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: moduleCachePath,
      },
      input: input.stdin,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    });
    const stderr = result.stderr ?? "";
    if (result.error !== undefined) {
      return { ok: false, error: result.error, stderr };
    }
    if (result.status === null) {
      return {
        ok: false,
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
    return { ok: false, error, stderr: "" };
  }
}

function validateWorkerResponse(
  value: unknown,
  request: ScannerWorkerRequest,
): string | undefined {
  if (!isRecord(value)) {
    return "worker response must be a JSON object";
  }
  if (value.schemaVersion !== 1) {
    return "worker response schemaVersion must be 1";
  }
  if (value.requestId !== request.requestId) {
    return "worker response requestId does not match the request";
  }
  if (value.language !== request.language) {
    return "worker response language does not match the request";
  }
  if (!Array.isArray(value.files)) {
    return "worker response files must be an array";
  }
  if (!responseFilesMatchRequest(value.files, request.files)) {
    return "worker response files must match requested files";
  }
  for (const file of value.files) {
    if (!isResponseFile(file)) {
      return "worker response files contain an invalid scan result";
    }
  }
  return undefined;
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

function isResponseFile(value: unknown): value is ScannerWorkerResponseFile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.filePath === "string" &&
    Array.isArray(value.symbols) &&
    Array.isArray(value.undocumentedSymbols) &&
    Array.isArray(value.links) &&
    Array.isArray(value.diagnostics)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scannerUnavailableDiagnostic(
  language: CodeLanguage,
  error: unknown,
): DocBridgeDiagnostic {
  const label = languageLabel(language);
  return {
    severity: "error",
    code: "code_scanner_unavailable",
    language,
    target: language,
    message: `${label} scanner worker is unavailable: ${reasonOf(error)}`,
  };
}

function scannerFailedDiagnostic(
  language: CodeLanguage,
  reason: string,
): DocBridgeDiagnostic {
  const label = languageLabel(language);
  return {
    severity: "error",
    code: "code_scanner_failed",
    language,
    target: language,
    message: `${label} scanner worker failed: ${reason}`,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function languageLabel(language: CodeLanguage): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}
