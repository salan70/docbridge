import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codeFileOwners,
  collectCodeFiles,
  createScannerWorkerAdapter,
  getCodeAdapter,
  isCodeLanguage,
  scanCodeFiles,
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
