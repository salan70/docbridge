import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectCodeFiles,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "../../config/code-language";
import type { DocBridgeDiagnostic } from "../../model/types";
import { check } from "../../query/check";
import { deferred, isAbortError, settledCancelable } from "../../shared/cancelable";
import { readManagedFile } from "../../shared/glob";
import type { CodeLanguageAdapter } from "./adapter";
import { createScannerWorkerAdapter, scanCodeFiles, scanCodeFilesAsync } from "./dispatch";
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
function echoingWorkerAsync(requests: RecordedRequest[], parseErrors: Record<string, string> = {}) {
  const run = echoingWorker(requests, parseErrors);
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

test("cancelling an asynchronous worker batch cancels the worker run and rejects", async () => {
  let cancelled = false;
  const goAdapter = createScannerWorkerAdapter("go", () => ["go-worker"], {
    runAsync: () => ({
      promise: deferred<ScannerWorkerProcessResult>().promise,
      cancel: () => {
        cancelled = true;
      },
    }),
  });
  const batch = asyncScan(goAdapter)(
    [{ filePath: "a.go", content: "" }],
    {},
    { projectRoot: "/project" },
  );

  batch.cancel();

  expect(cancelled).toBe(true);
  expect(isAbortError(await batch.promise.catch((reason: unknown) => reason))).toBe(true);
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

  const prepared = await prepareOf(goAdapter)({ projectRoot: "/project" }).promise;
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

test("the worker command factory receives the scan context on the sync and async paths", async () => {
  const requests: RecordedRequest[] = [];
  const seen: unknown[] = [];
  const scanners = { ruby: { command: ["/opt/ruby/bin/ruby"] } };
  const adapters = {
    go: createScannerWorkerAdapter(
      "go",
      (context) => {
        seen.push(context);
        return ["go-worker"];
      },
      { run: echoingWorker(requests), runAsync: echoingWorkerAsync(requests) },
    ),
  };
  const include: CodeInclude = { go: { patterns: ["**/*.go"] } };
  const read = contentsOf({ "a.go": "package a\n" });

  scanCodeFiles("/project", goFiles("a.go"), include, read, { adapters, scanners });
  await scanCodeFilesAsync("/project", goFiles("a.go"), include, read, { adapters, scanners })
    .promise;

  expect(seen).toEqual([
    { projectRoot: "/project", scanners },
    { projectRoot: "/project", scanners },
  ]);
});

test.each([
  ["python", "src/a.py"],
  ["ruby", "lib/a.rb"],
  ["java", "src/main/java/A.java"],
] as const)(
  "the built-in %s adapter runs the configured runtime and reports it without fallback",
  (language, relPath) => {
    const runtime = `/nonexistent/docbridge/${language}`;

    const result = scanCodeFiles(
      "/project",
      [{ language, relPath }],
      { [language]: { patterns: ["**/*"] } },
      () => ({ ok: true, content: "" }),
      { scanners: { [language]: { command: [runtime] } } },
    );

    expect(result.diagnostics).toMatchObject([
      {
        code: "code_scanner_unavailable",
        language,
        target: relPath,
        message: expect.stringContaining(`scanners.${language}.command (${runtime})`),
      },
    ]);
  },
);

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

  const prepared = await prepareOf(goAdapter)({ projectRoot: "/project" }).promise;
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

test("the asynchronous paths run the worker command that commandAsync resolves", async () => {
  const requests: RecordedRequest[] = [];
  const commands: string[][] = [];
  const echo = echoingWorkerAsync(requests);
  const goAdapter = createScannerWorkerAdapter("go", () => ["sync-go-worker"], {
    commandAsync: () => settledCancelable(["async-go-worker"]),
    runAsync: (input) => {
      commands.push(input.command);
      return echo(input);
    },
  });

  await scanCodeFilesAsync(
    "/project",
    goFiles("a.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n" }),
    { adapters: { go: goAdapter } },
  ).promise;
  await asyncScan(goAdapter)([{ filePath: "b.go", content: "" }], {}, { projectRoot: "/project" })
    .promise;

  expect(commands).toEqual([["async-go-worker"], ["async-go-worker"]]);
  expect(requestedPaths(requests)).toEqual([["a.go"], ["b.go"]]);
});

test("cancelling scanCodeFilesAsync cancels a worker command resolution and starts no worker", async () => {
  let resolutionCancelled = false;
  const started: string[][] = [];
  const goAdapter = createScannerWorkerAdapter(
    "go",
    () => {
      throw new Error("the asynchronous scan resolved the worker command synchronously");
    },
    {
      commandAsync: () => ({
        promise: deferred<string[]>().promise,
        cancel: () => {
          resolutionCancelled = true;
        },
      }),
      runAsync: (input) => {
        started.push(input.command);
        return settledCancelable<ScannerWorkerProcessResult>({
          ok: true,
          exitCode: 2,
          stdout: "",
          stderr: "",
        });
      },
    },
  );
  const task = scanCodeFilesAsync(
    "/project",
    goFiles("a.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n" }),
    { adapters: { go: goAdapter } },
  );

  task.cancel();

  expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
  expect(resolutionCancelled).toBe(true);
  expect(started).toEqual([]);
});

test("cancelling prepare rejects with an AbortError even when the resolution already finished", async () => {
  const goAdapter = createScannerWorkerAdapter("go", () => ["fake"]);
  const prepared = prepareOf(goAdapter)({ projectRoot: "/project" });

  prepared.cancel();

  expect(isAbortError(await prepared.promise.catch((reason: unknown) => reason))).toBe(true);
});

test("cancelling scanCodeFilesAsync right away starts no worker", async () => {
  const events: string[] = [];
  const goAdapter = createScannerWorkerAdapter("go", () => ["fake"], {
    runAsync: () => {
      events.push("worker started");
      return {
        promise: deferred<ScannerWorkerProcessResult>().promise,
        cancel: () => {
          events.push("worker cancelled");
        },
      };
    },
  });
  const task = scanCodeFilesAsync(
    "/project",
    goFiles("a.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n" }),
    { adapters: { go: goAdapter } },
  );

  task.cancel();

  expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
  expect(events).toEqual([]);
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

test("an asynchronous scan probes a configured runtime in the background and kills the probe when cancelled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "docbridge-slow-runtime-"));
  try {
    const pidFile = join(dir, "pid");
    const runtime = join(dir, "slow-python");
    writeFileSync(
      runtime,
      [
        "#!/bin/sh",
        `echo $$ > '${pidFile}.tmp' && mv '${pidFile}.tmp' '${pidFile}'`,
        "sleep 1",
        `printf '%s\\n' '{"ok": false, "reason": "a slow fake runtime"}'`,
        "",
      ].join("\n"),
    );
    chmodSync(runtime, 0o755);
    const task = scanCodeFilesAsync(
      dir,
      [{ language: "python", relPath: "a.py" }],
      { python: { patterns: ["**/*.py"] } },
      () => ({ ok: true, content: "" }),
      { scanners: { python: { command: [runtime] } } },
    );
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);

    await eventually(() => timerFired && existsSync(pidFile));
    const probe = Number(readFileSync(pidFile, "utf8").trim());
    expect(isAlive(probe)).toBe(true);

    task.cancel();

    expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
    await eventually(() => !isAlive(probe), 1_500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function goFiles(...relPaths: string[]): CollectedCodeFile[] {
  return relPaths.map((relPath) => ({ language: "go", relPath }));
}

function contentsOf(contents: Record<string, string>) {
  return (relPath: string): CodeFileRead => {
    const content = contents[relPath];
    return content === undefined
      ? {
          ok: false,
          diagnostic: {
            severity: "error",
            code: "file_read_error",
            target: relPath,
            message: "gone",
          },
        }
      : { ok: true, content };
  };
}

test("scanCodeFilesAsync rescans only files whose content changed since the cached scan", async () => {
  const requests: RecordedRequest[] = [];
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: echoingWorkerAsync(requests),
    }),
  };
  const first = await scanCodeFilesAsync(
    "/project",
    goFiles("a.go", "b.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n", "b.go": "package a\n" }),
    { adapters },
  ).promise;

  const second = await scanCodeFilesAsync(
    "/project",
    goFiles("a.go", "b.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n", "b.go": "package a // edited\n" }),
    { adapters, cache: first.cache },
  ).promise;

  expect(requestedPaths(requests)).toEqual([["a.go", "b.go"], ["b.go"]]);
  expect(second.codeFiles.map((file) => file.filePath)).toEqual(["a.go", "b.go"]);
  expect(second.codeFiles[0]).toBe(first.codeFiles[0]);
});

test("scanCodeFilesAsync rescans every file when the resolved worker command changes", async () => {
  const requests: RecordedRequest[] = [];
  let version = 1;
  const adapters = {
    go: createScannerWorkerAdapter("go", () => [`/opt/go-worker-${version}`], {
      runAsync: echoingWorkerAsync(requests),
    }),
  };
  const read = contentsOf({ "a.go": "package a\n" });
  const first = await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
  }).promise;

  version = 2;
  await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
    cache: first.cache,
  }).promise;

  expect(requestedPaths(requests)).toEqual([["a.go"], ["a.go"]]);
});

test("scanCodeFilesAsync rescans every file when the configured visibility changes", async () => {
  const requests: RecordedRequest[] = [];
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: echoingWorkerAsync(requests),
    }),
  };
  const read = contentsOf({ "a.go": "package a\n" });
  const first = await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
  }).promise;

  await scanCodeFilesAsync(
    "/project",
    goFiles("a.go"),
    { go: { patterns: ["**/*.go"], visibility: ["exported", "unexported"] } },
    read,
    { adapters, cache: first.cache },
  ).promise;

  expect(requestedPaths(requests)).toEqual([["a.go"], ["a.go"]]);
});

test("scanCodeFilesAsync reuses a parse error but rescans after a scanner failure", async () => {
  const requests: RecordedRequest[] = [];
  const read = contentsOf({ "a.go": "package\n" });
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: echoingWorkerAsync(requests, { "a.go": "syntax error" }),
    }),
  };
  let launches = 0;
  const failing = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: () => {
        launches += 1;
        return settledCancelable<ScannerWorkerProcessResult>({
          ok: true,
          exitCode: 2,
          stdout: "",
          stderr: "",
        });
      },
    }),
  };

  const parsed = await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
  }).promise;
  await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
    cache: parsed.cache,
  }).promise;
  const failed = await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters: failing,
  }).promise;
  await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters: failing,
    cache: failed.cache,
  }).promise;

  expect(requestedPaths(requests)).toEqual([["a.go"]]);
  expect(parsed.cache.size).toBe(1);
  expect(failed.cache.size).toBe(0);
  expect(launches).toBe(2);
});

test("scanCodeFilesAsync keeps only the files of this scan in the returned cache", async () => {
  const requests: RecordedRequest[] = [];
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: echoingWorkerAsync(requests),
    }),
  };
  const read = contentsOf({ "a.go": "package a\n", "b.go": "package a\n" });
  const first = await scanCodeFilesAsync(
    "/project",
    goFiles("a.go", "b.go"),
    GO_AND_TYPESCRIPT,
    read,
    { adapters },
  ).promise;

  const second = await scanCodeFilesAsync("/project", goFiles("a.go"), GO_AND_TYPESCRIPT, read, {
    adapters,
    cache: first.cache,
  }).promise;

  expect(first.cache.size).toBe(2);
  expect(second.cache.size).toBe(1);
});

test("scanCodeFilesAsync reads every file before the first worker starts", () => {
  const events: string[] = [];
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: () => {
        events.push("worker");
        return { promise: deferred<ScannerWorkerProcessResult>().promise, cancel: () => undefined };
      },
    }),
  };

  const task = scanCodeFilesAsync(
    "/project",
    goFiles("a.go", "b.go"),
    GO_AND_TYPESCRIPT,
    (relPath) => {
      events.push(`read ${relPath}`);
      return { ok: true, content: "package a\n" };
    },
    { adapters },
  );
  task.promise.catch(() => undefined);
  task.cancel();

  expect(events.slice(0, 2)).toEqual(["read a.go", "read b.go"]);
});

test("cancelling scanCodeFilesAsync cancels the running worker batch and rejects", async () => {
  let cancelled = false;
  const started = deferred<void>();
  const adapters = {
    go: createScannerWorkerAdapter("go", () => ["go-worker"], {
      runAsync: () => {
        started.resolve();
        return {
          promise: deferred<ScannerWorkerProcessResult>().promise,
          cancel: () => {
            cancelled = true;
          },
        };
      },
    }),
  };
  const task = scanCodeFilesAsync(
    "/project",
    goFiles("a.go"),
    GO_AND_TYPESCRIPT,
    contentsOf({ "a.go": "package a\n" }),
    { adapters },
  );
  // The adapter is prepared asynchronously, so the batch starts after the call returns.
  await started.promise;

  task.cancel();

  expect(isAbortError(await task.promise.catch((reason: unknown) => reason))).toBe(true);
  expect(cancelled).toBe(true);
});

test("a worker adapter starts the worker without the variables its resolution strips", async () => {
  const stripped: Array<readonly string[] | undefined> = [];
  const exited: ScannerWorkerProcessResult = { ok: true, exitCode: 2, stdout: "", stderr: "" };
  const rubyLikeAdapter = createScannerWorkerAdapter(
    "go",
    () => ({ ok: true, command: ["/usr/bin/runtime", "worker.rb"], stripEnv: ["RUBYOPT"] }),
    {
      run: (input) => {
        stripped.push(input.stripEnv);
        return exited;
      },
      runAsync: (input) => {
        stripped.push(input.stripEnv);
        return settledCancelable(exited);
      },
    },
  );

  rubyLikeAdapter.scanFiles([{ filePath: "a.go", content: "" }], {}, { projectRoot: "/project" });
  await asyncScan(rubyLikeAdapter)(
    [{ filePath: "a.go", content: "" }],
    {},
    {
      projectRoot: "/project",
    },
  ).promise;

  expect(stripped).toEqual([["RUBYOPT"], ["RUBYOPT"]]);
});
