import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectCodeFiles, type CodeInclude } from "./code-language";
import { createScannerWorkerAdapter, scanCodeFiles } from "./code-scan";
import { setCodeAdapterForTest } from "./code-scan.test-support";
import { readManagedFile } from "./glob";
import { check } from "./resolver";
import type { ScannerWorkerProcessResult } from "./scanner-worker";

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
      const result = scanCodeFiles(root, collectCodeFiles(root, include), include, (relPath) =>
        readManagedFile(root, relPath),
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
