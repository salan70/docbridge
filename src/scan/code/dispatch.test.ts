import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectCodeFiles, type CodeInclude } from "../../config/code-language";
import type { DocBridgeDiagnostic } from "../../model/types";
import { check } from "../../query/check";
import { deferred } from "../../shared/cancelable";
import { readManagedFile } from "../../shared/glob";
import type { CodeLanguageAdapter } from "./adapter";
import { createScannerWorkerAdapter, scanCodeFiles } from "./dispatch";
import type { ScannerWorkerProcessResult } from "./worker/scanner-worker";

function withProject(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docbridge-lang-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const abs = join(root, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("scanCodeFiles reports scanner resolution diagnostics without starting a worker", () => {
  withProject({ "lib/auth.dart": "class AuthService {}\n" }, (root) => {
    const dartAdapter = createScannerWorkerAdapter("dart", () => ({
      ok: false,
      diagnostic: {
        severity: "error",
        code: "code_scanner_unavailable",
        language: "dart",
        target: "dart",
        message:
          "Dart scanner worker is unavailable for platform linux-arm64; supported platforms: darwin-arm64, linux-x64",
      },
    }));
    const include: CodeInclude = { dart: { patterns: ["lib/**/*.dart"] } };

    const result = scanCodeFiles(
      root,
      collectCodeFiles(root, include),
      include,
      (relPath) => readManagedFile(root, relPath),
      { adapters: { dart: dartAdapter } },
    );

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "code_scanner_unavailable",
        language: "dart",
        target: "lib/auth.dart",
        message:
          "Dart scanner worker is unavailable for platform linux-arm64; supported platforms: darwin-arm64, linux-x64",
      },
    ]);
    expect(result.codeFiles[0]?.language).toBe("dart");
  });
});

test("check suppresses link diagnostics that depend on a failed worker scan", () => {
  withProject(
    {
      "docbridge.config.json": JSON.stringify({
        include: {
          code: { swift: { patterns: ["Sources/**/*.swift"] } },
          docs: ["docs/**/*.md"],
        },
      }),
      "Sources/Auth.swift": "public struct AuthService {}\n",
      "docs/auth.md": "<!-- @code Sources/Auth.swift#AuthService -->\n## Auth Service\n",
    },
    (root) => {
      const swiftAdapter = createScannerWorkerAdapter("swift", () => ["missing-swift-worker"], {
        requestId: () => "req-swift-missing",
        run: (): ScannerWorkerProcessResult => ({
          ok: false,
          error: new Error("ENOENT"),
          stderr: "",
        }),
      });

      const diagnostics = check({
        projectRoot: root,
        adapters: { swift: swiftAdapter },
      }).diagnostics;

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "code_scanner_unavailable",
      ]);
      expect(diagnostics[0]?.target).toBe("Sources/Auth.swift");
    },
  );
});

type RecordedRequest = { files: Array<{ filePath: string }> };

/** A worker runner that answers every request with one empty result per file. */
function echoingWorker(requests: RecordedRequest[], parseErrors: Record<string, string> = {}) {
  return (input: { stdin: string }): ScannerWorkerProcessResult => {
    const request = JSON.parse(input.stdin) as RecordedRequest & {
      requestId: string;
      language: string;
    };
    requests.push(request);
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        requestId: request.requestId,
        language: request.language,
        files: request.files.map(({ filePath }) => ({
          filePath,
          symbols: [],
          undocumentedSymbols: [],
          links: [],
          diagnostics:
            parseErrors[filePath] === undefined
              ? []
              : [
                  {
                    severity: "error",
                    code: "code_parse_error",
                    target: filePath,
                    message: parseErrors[filePath],
                  },
                ],
        })),
      }),
      stderr: "",
    };
  };
}

function requestedPaths(requests: RecordedRequest[]): string[][] {
  return requests.map((request) => request.files.map((file) => file.filePath));
}

const GO_AND_TYPESCRIPT: CodeInclude = {
  go: { patterns: ["**/*.go"] },
  typescript: { patterns: ["**/*.ts"] },
};

test("scanCodeFiles sends every file of a language in one request and keeps collection order", () => {
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    run: echoingWorker(requests),
  });

  const result = scanCodeFiles(
    "/project",
    [
      { language: "go", relPath: "a.go" },
      { language: "typescript", relPath: "b.ts" },
      { language: "go", relPath: "c.go" },
    ],
    GO_AND_TYPESCRIPT,
    () => ({ ok: true, content: "" }),
    { adapters: { go: goAdapter } },
  );

  expect(requestedPaths(requests)).toEqual([["a.go", "c.go"]]);
  expect(result.codeFiles.map((file) => [file.language, file.filePath])).toEqual([
    ["go", "a.go"],
    ["typescript", "b.ts"],
    ["go", "c.go"],
  ]);
});

test("scanCodeFiles keeps a read error at its position among scanned files", () => {
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    run: echoingWorker(requests, { "a.go": "first", "c.go": "third" }),
  });

  const result = scanCodeFiles(
    "/project",
    [
      { language: "go", relPath: "a.go" },
      { language: "go", relPath: "b.go" },
      { language: "go", relPath: "c.go" },
    ],
    GO_AND_TYPESCRIPT,
    (relPath) =>
      relPath === "b.go"
        ? {
            ok: false,
            diagnostic: {
              severity: "error",
              code: "file_read_error",
              target: "b.go",
              message: "second",
            },
          }
        : { ok: true, content: "" },
    { adapters: { go: goAdapter } },
  );

  expect(requestedPaths(requests)).toEqual([["a.go", "c.go"]]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(result.codeFiles.map((file) => file.filePath)).toEqual(["a.go", "c.go"]);
});

function exitFailure(target: string): DocBridgeDiagnostic {
  return {
    severity: "error",
    code: "code_scanner_failed",
    language: "go",
    target,
    message: "Go scanner worker failed: worker exited with status 2",
  };
}

test("a worker process failure reports the same diagnostic for every file in the request", () => {
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    run: (): ScannerWorkerProcessResult => ({ ok: true, exitCode: 2, stdout: "", stderr: "" }),
  });

  const result = scanCodeFiles(
    "/project",
    [
      { language: "go", relPath: "a.go" },
      { language: "go", relPath: "c.go" },
    ],
    GO_AND_TYPESCRIPT,
    () => ({ ok: true, content: "package a\n" }),
    { adapters: { go: goAdapter } },
  );

  expect(result.diagnostics).toEqual([exitFailure("a.go"), exitFailure("c.go")]);
  expect(result.codeFiles).toEqual([
    {
      language: "go",
      filePath: "a.go",
      symbols: [],
      undocumentedSymbols: [],
      links: [],
      diagnostics: [exitFailure("a.go")],
    },
    {
      language: "go",
      filePath: "c.go",
      symbols: [],
      undocumentedSymbols: [],
      links: [],
      diagnostics: [exitFailure("c.go")],
    },
  ]);
});

test("scanCodeFiles starts no worker for a language without a readable file", () => {
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    run: echoingWorker(requests),
  });

  scanCodeFiles(
    "/project",
    [{ language: "go", relPath: "a.go" }],
    GO_AND_TYPESCRIPT,
    () => ({
      ok: false,
      diagnostic: { severity: "error", code: "file_read_error", target: "a.go", message: "gone" },
    }),
    { adapters: { go: goAdapter } },
  );

  expect(requests).toEqual([]);
});

test("a worker adapter scans a single file through a one-file request", () => {
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    run: echoingWorker(requests),
  });

  const scan = goAdapter.scanFile("a.go", "package a\n", {}, { projectRoot: "/project" });

  expect(scan.filePath).toBe("a.go");
  expect(requestedPaths(requests)).toEqual([["a.go"]]);
});

test("check suppresses link diagnostics for every file of a failed worker request", () => {
  withProject(
    {
      "docbridge.config.json": JSON.stringify({
        include: {
          code: { swift: { patterns: ["Sources/**/*.swift"] } },
          docs: ["docs/**/*.md"],
        },
      }),
      "Sources/Auth.swift": "public struct AuthService {}\n",
      "Sources/Billing.swift": "public struct BillingService {}\n",
      "docs/auth.md": [
        "<!-- @code Sources/Auth.swift#AuthService -->",
        "## Auth Service",
        "",
        "<!-- @code Sources/Billing.swift#BillingService -->",
        "## Billing Service",
        "",
      ].join("\n"),
    },
    (root) => {
      let launches = 0;
      const swiftAdapter = createScannerWorkerAdapter("swift", () => ["crashing-swift-worker"], {
        run: (): ScannerWorkerProcessResult => {
          launches += 1;
          return { ok: false, kind: "execution", error: new Error("boom"), stderr: "" };
        },
      });

      const diagnostics = check({
        projectRoot: root,
        adapters: { swift: swiftAdapter },
      }).diagnostics;

      expect(launches).toBe(1);
      expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.target])).toEqual([
        ["code_scanner_failed", "Sources/Auth.swift"],
        ["code_scanner_failed", "Sources/Billing.swift"],
      ]);
    },
  );
});

/** The asynchronous form of {@link echoingWorker}. */
function echoingWorkerAsync(requests: RecordedRequest[]) {
  const run = echoingWorker(requests);
  return (input: { stdin: string }) => ({
    promise: Promise.resolve(run(input)),
    cancel: () => undefined,
  });
}

function asyncScan(adapter: CodeLanguageAdapter) {
  const scanFilesAsync = adapter.scanFilesAsync;
  if (scanFilesAsync === undefined) {
    throw new Error(`${adapter.language} adapter has no asynchronous scan`);
  }
  return scanFilesAsync;
}

function prepareOf(adapter: CodeLanguageAdapter) {
  const prepare = adapter.prepare;
  if (prepare === undefined) {
    throw new Error(`${adapter.language} adapter has no prepare`);
  }
  return prepare;
}

test("a worker adapter scans a batch asynchronously in one request", async () => {
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    runAsync: echoingWorkerAsync(requests),
  });

  const scans = await asyncScan(goAdapter)(
    [
      { filePath: "a.go", content: "package a\n" },
      { filePath: "b.go", content: "package a\n" },
    ],
    {},
    { projectRoot: "/project" },
  ).promise;

  expect(requestedPaths(requests)).toEqual([["a.go", "b.go"]]);
  expect(scans.map((scan) => scan.filePath)).toEqual(["a.go", "b.go"]);
});

test("an asynchronous worker failure reports the diagnostic for every file in the request", async () => {
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    runAsync: () => ({
      promise: Promise.resolve<ScannerWorkerProcessResult>({
        ok: true,
        exitCode: 2,
        stdout: "",
        stderr: "",
      }),
      cancel: () => undefined,
    }),
  });

  const scans = await asyncScan(goAdapter)(
    [
      { filePath: "a.go", content: "" },
      { filePath: "c.go", content: "" },
    ],
    {},
    { projectRoot: "/project" },
  ).promise;

  expect(scans.map((scan) => scan.diagnostics)).toEqual([
    [exitFailure("a.go")],
    [exitFailure("c.go")],
  ]);
});

test("cancelling an asynchronous worker batch cancels the worker run", () => {
  let cancelled = false;
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    runAsync: () => ({
      promise: deferred<ScannerWorkerProcessResult>().promise,
      cancel: () => {
        cancelled = true;
      },
    }),
  });

  asyncScan(goAdapter)(
    [{ filePath: "a.go", content: "" }],
    {},
    { projectRoot: "/project" },
  ).cancel();

  expect(cancelled).toBe(true);
});

test("prepare resolves the worker command once and binds the adapter to it", async () => {
  let resolutions = 0;
  const requests: RecordedRequest[] = [];
  const goAdapter = createScannerWorkerAdapter(
    "go",
    () => {
      resolutions += 1;
      return { ok: true, command: ["/opt/go-worker", "--strict"] };
    },
    { run: echoingWorker(requests), runAsync: echoingWorkerAsync(requests) },
  );

  const prepared = prepareOf(goAdapter)({ projectRoot: "/project" });
  prepared.adapter.scanFiles([{ filePath: "a.go", content: "" }], {}, { projectRoot: "/project" });
  await asyncScan(prepared.adapter)(
    [{ filePath: "b.go", content: "" }],
    {},
    {
      projectRoot: "/project",
    },
  ).promise;

  expect(prepared.argv).toEqual(["/opt/go-worker", "--strict"]);
  expect(resolutions).toBe(1);
  expect(requestedPaths(requests)).toEqual([["a.go"], ["b.go"]]);
});

test("prepare carries a command resolution failure to every file without starting a worker", async () => {
  const requests: RecordedRequest[] = [];
  const unavailable: DocBridgeDiagnostic = {
    severity: "error",
    code: "code_scanner_unavailable",
    language: "go",
    target: "go",
    message: "Go scanner worker is unavailable: missing",
  };
  const goAdapter = createScannerWorkerAdapter(
    "go",
    () => ({ ok: false, diagnostic: unavailable }),
    {
      run: echoingWorker(requests),
      runAsync: echoingWorkerAsync(requests),
    },
  );

  const prepared = prepareOf(goAdapter)({ projectRoot: "/project" });
  const scans = await asyncScan(prepared.adapter)(
    [
      { filePath: "a.go", content: "" },
      { filePath: "b.go", content: "" },
    ],
    {},
    { projectRoot: "/project" },
  ).promise;

  expect(prepared.argv).toEqual([]);
  expect(requests).toEqual([]);
  expect(scans.map((scan) => scan.diagnostics.map((diagnostic) => diagnostic.target))).toEqual([
    ["a.go"],
    ["b.go"],
  ]);
});
