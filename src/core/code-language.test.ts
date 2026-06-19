import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  codeFileOwners,
  collectCodeFiles,
  createScannerWorkerAdapter,
  getCodeAdapter,
  isCodeLanguage,
  resolveScannerWorkerCommand,
  scanCodeFiles,
  scannerRootsFromModuleUrl,
  setCodeAdapterForTest,
  type CodeInclude,
} from "./code-language";
import { readManagedFile } from "./glob";
import { check } from "./resolver";
import type { ScannerWorkerProcessResult } from "./scanner-worker";

function withProject(
  files: Record<string, string>,
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "speclink-lang-"));
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

test("isCodeLanguage accepts the fixed language IDs and rejects others", () => {
  expect(isCodeLanguage("typescript")).toBe(true);
  expect(isCodeLanguage("swift")).toBe(true);
  expect(isCodeLanguage("dart")).toBe(true);
  expect(isCodeLanguage("kotlin")).toBe(false);
});

test("TypeScript has an in-process adapter and Swift/Dart have worker-backed adapters", () => {
  expect(getCodeAdapter("typescript")?.language).toBe("typescript");
  expect(getCodeAdapter("swift")?.language).toBe("swift");
  expect(getCodeAdapter("dart")?.language).toBe("dart");
});

test("resolveScannerWorkerCommand selects the dist scanner for a supported platform", () => {
  withProject(
    { "dist/bin/darwin-arm64/speclink-swift-scanner": "#!/bin/sh\n" },
    (root) => {
      const scannerPath = join(
        root,
        "dist/bin/darwin-arm64/speclink-swift-scanner",
      );
      chmodSync(scannerPath, 0o755);

      const result = resolveScannerWorkerCommand("swift", {
        platformKey: "darwin-arm64",
        sourceRoot: join(root, "missing-source"),
        distRoot: join(root, "dist"),
      });

      expect(result).toEqual({ ok: true, command: [scannerPath] });
    },
  );
});

test("resolveScannerWorkerCommand selects source scanners on unsupported dist platforms", () => {
  withProject(
    {
      "packages/swift-scanner/.build/release/speclink-swift-scanner":
        "#!/bin/sh\n",
    },
    (root) => {
      const scannerPath = join(
        root,
        "packages/swift-scanner/.build/release/speclink-swift-scanner",
      );
      chmodSync(scannerPath, 0o755);

      const result = resolveScannerWorkerCommand("swift", {
        platformKey: "darwin-x64",
        sourceRoot: root,
        distRoot: join(root, "missing-dist"),
      });

      expect(result).toEqual({ ok: true, command: [scannerPath] });
    },
  );
});

test("scannerRootsFromModuleUrl resolves through a symlinked bin shim", () => {
  // npm installs the CLI as `node_modules/.bin/<cli>`, a relative symlink to
  // the packaged `dist/index.js`. The dist scanner binaries sit next to that
  // real file, so the dist root must follow the symlink to its target — Bun
  // resolves this on macOS but not on Linux, where the bug surfaced.
  withProject({ "pkg/dist/index.js": "// cli\n" }, (root) => {
    const realCli = join(root, "pkg/dist/index.js");
    const binDir = join(root, "node_modules/.bin");
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, "speclink");
    symlinkSync(relative(binDir, realCli), shim);

    const { distRoot, sourceRoot } = scannerRootsFromModuleUrl(
      pathToFileURL(shim).href,
    );

    // Compare against the canonical root: realpath also normalizes symlinks in
    // the temp path itself (e.g. macOS /var -> /private/var).
    const realRoot = realpathSync(root);
    expect(distRoot).toBe(join(realRoot, "pkg/dist"));
    expect(sourceRoot).toBe(realRoot);
  });
});

test("resolveScannerWorkerCommand reports unsupported scanner platforms", () => {
  const result = resolveScannerWorkerCommand("dart", {
    platformKey: "linux-arm64",
    sourceRoot: "/missing-source",
    distRoot: "/missing-dist",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.code).toBe("code_scanner_unavailable");
    expect(result.diagnostic.message).toContain("linux-arm64");
    expect(result.diagnostic.message).toContain("darwin-arm64");
    expect(result.diagnostic.message).toContain("linux-x64");
  }
});

test("scanCodeFiles reports scanner resolution diagnostics without starting a worker", () => {
  withProject({ "lib/auth.dart": "class AuthService {}\n" }, (root) => {
    const restore = setCodeAdapterForTest(
      "dart",
      createScannerWorkerAdapter("dart", () => ({
        ok: false,
        diagnostic: {
          severity: "error",
          code: "code_scanner_unavailable",
          language: "dart",
          target: "dart",
          message:
            "Dart scanner worker is unavailable for platform linux-arm64; supported platforms: darwin-arm64, linux-x64",
        },
      })),
    );
    try {
      const include: CodeInclude = { dart: { patterns: ["lib/**/*.dart"] } };
      const result = scanCodeFiles(
        root,
        collectCodeFiles(root, include),
        include,
        (relPath) => readManagedFile(root, relPath),
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
    } finally {
      restore();
    }
  });
});

test("collectCodeFiles tags each managed file with its language", () => {
  withProject(
    { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" },
    (root) => {
      const include: CodeInclude = { typescript: { patterns: ["src/**/*.ts"] } };
      expect(collectCodeFiles(root, include)).toEqual([
        { language: "typescript", relPath: "src/a.ts" },
        { language: "typescript", relPath: "src/b.ts" },
      ]);
    },
  );
});

test("scanCodeFiles dispatches to the TypeScript adapter", () => {
  withProject({ "src/a.ts": "export const a = 1;\n" }, (root) => {
    const include: CodeInclude = { typescript: { patterns: ["src/**/*.ts"] } };
    const result = scanCodeFiles(root, collectCodeFiles(root, include), include, (relPath) =>
      readManagedFile(root, relPath),
    );
    expect(result.codeFiles).toHaveLength(1);
    expect(result.codeFiles[0]?.language).toBe("typescript");
    expect(result.codeFiles[0]?.filePath).toBe("src/a.ts");
  });
});

test("scanCodeFiles dispatches configured non-TypeScript files to a worker adapter", () => {
  withProject({ "Sources/Auth.swift": "public struct AuthService {}\n" }, (root) => {
    const restore = setCodeAdapterForTest(
      "swift",
      createScannerWorkerAdapter("swift", () => ["mock-swift-worker"], {
        requestId: () => "req-swift",
        run: (input) => {
          const request = JSON.parse(input.stdin);
          expect(input.command).toEqual(["mock-swift-worker"]);
          expect(request.projectRoot).toBe(root);
          expect(request.files).toEqual([
            {
              filePath: "Sources/Auth.swift",
              content: "public struct AuthService {}\n",
            },
          ]);
          return {
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({
              schemaVersion: 1,
              requestId: "req-swift",
              language: "swift",
              files: [
                {
                  filePath: "Sources/Auth.swift",
                  symbols: [
                    {
                      kind: "code",
                      language: "swift",
                      filePath: "Sources/Auth.swift",
                      symbolName: "AuthService",
                      canonicalId: "AuthService",
                      endpoint: "Sources/Auth.swift#AuthService",
                      location: {
                        filePath: "Sources/Auth.swift",
                        line: 1,
                        column: 15,
                      },
                    },
                  ],
                  undocumentedSymbols: [],
                  links: [],
                  diagnostics: [],
                },
              ],
            }),
            stderr: "",
          };
        },
      }),
    );
    try {
      const include: CodeInclude = { swift: { patterns: ["Sources/**/*.swift"] } };
      const result = scanCodeFiles(
        root,
        collectCodeFiles(root, include),
        include,
        (relPath) => readManagedFile(root, relPath),
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.codeFiles).toHaveLength(1);
      expect(result.codeFiles[0]?.language).toBe("swift");
      expect(result.codeFiles[0]?.symbols[0]?.endpoint).toBe(
        "Sources/Auth.swift#AuthService",
      );
    } finally {
      restore();
    }
  });
});

test("check resolves links from a worker-backed language scan", () => {
  withProject(
    {
      "speclink.config.json": JSON.stringify({
        include: {
          code: { swift: { patterns: ["Sources/**/*.swift"] } },
          docs: ["docs/**/*.md"],
        },
      }),
      "Sources/Auth.swift": "/// @doc docs/auth.md#auth-service\npublic struct AuthService {}\n",
      "docs/auth.md": "<!-- @code Sources/Auth.swift#AuthService -->\n## Auth Service\n",
    },
    (root) => {
      const restore = setCodeAdapterForTest(
        "swift",
        createScannerWorkerAdapter("swift", () => ["mock-swift-worker"], {
          requestId: () => "req-swift-check",
          run: () => ({
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({
              schemaVersion: 1,
              requestId: "req-swift-check",
              language: "swift",
              files: [
                {
                  filePath: "Sources/Auth.swift",
                  symbols: [
                    {
                      kind: "code",
                      language: "swift",
                      filePath: "Sources/Auth.swift",
                      symbolName: "AuthService",
                      canonicalId: "AuthService",
                      endpoint: "Sources/Auth.swift#AuthService",
                      location: {
                        filePath: "Sources/Auth.swift",
                        line: 2,
                        column: 15,
                      },
                    },
                  ],
                  undocumentedSymbols: [],
                  links: [
                    {
                      direction: "code-to-doc",
                      source: "Sources/Auth.swift#AuthService",
                      target: "docs/auth.md#auth-service",
                      location: {
                        filePath: "Sources/Auth.swift",
                        line: 1,
                        column: 5,
                      },
                    },
                  ],
                  diagnostics: [],
                },
              ],
            }),
            stderr: "",
          }),
        }),
      );
      try {
        expect(check({ projectRoot: root }).diagnostics).toEqual([]);
      } finally {
        restore();
      }
    },
  );
});

test("check suppresses link diagnostics that depend on a failed worker scan", () => {
  withProject(
    {
      "speclink.config.json": JSON.stringify({
        include: {
          code: { swift: { patterns: ["Sources/**/*.swift"] } },
          docs: ["docs/**/*.md"],
        },
      }),
      "Sources/Auth.swift": "public struct AuthService {}\n",
      "docs/auth.md": "<!-- @code Sources/Auth.swift#AuthService -->\n## Auth Service\n",
    },
    (root) => {
      const restore = setCodeAdapterForTest(
        "swift",
        createScannerWorkerAdapter("swift", () => ["missing-swift-worker"], {
          requestId: () => "req-swift-missing",
          run: (): ScannerWorkerProcessResult => ({
            ok: false,
            error: new Error("ENOENT"),
            stderr: "",
          }),
        }),
      );
      try {
        const diagnostics = check({ projectRoot: root }).diagnostics;
        expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
          "code_scanner_unavailable",
        ]);
        expect(diagnostics[0]?.target).toBe("Sources/Auth.swift");
      } finally {
        restore();
      }
    },
  );
});

test("codeFileOwners flags a file matched by more than one language", () => {
  withProject({ "shared/a.ts": "export const a = 1;\n" }, (root) => {
    // Construct an include where two languages glob the same file. This bypasses
    // config suffix validation to exercise the overlap-detection guard directly.
    const include: CodeInclude = {
      typescript: { patterns: ["shared/**/*.ts"] },
      swift: { patterns: ["shared/**/*.ts"] },
    };
    const owners = codeFileOwners(root, include);
    expect(owners.get("shared/a.ts")).toEqual(["typescript", "swift"]);
  });
});
