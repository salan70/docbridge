import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codeFileOwners,
  collectCodeFiles,
  getCodeAdapter,
  isCodeLanguage,
  scanCodeFiles,
  type CodeInclude,
} from "./code-language";
import { readManagedFile } from "./glob";

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

test("only TypeScript has a registered adapter in this slice", () => {
  expect(getCodeAdapter("typescript")?.language).toBe("typescript");
  expect(getCodeAdapter("swift")).toBeUndefined();
  expect(getCodeAdapter("dart")).toBeUndefined();
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
    const result = scanCodeFiles(collectCodeFiles(root, include), include, (relPath) =>
      readManagedFile(root, relPath),
    );
    expect(result.codeFiles).toHaveLength(1);
    expect(result.codeFiles[0]?.language).toBe("typescript");
    expect(result.codeFiles[0]?.filePath).toBe("src/a.ts");
  });
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
