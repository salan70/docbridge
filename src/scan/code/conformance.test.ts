import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { KNOWN_CODE_LANGUAGES } from "../../config/code-language";
import type { CodeLanguage } from "../../model/types";
import { scanCodeFiles } from "./dispatch";

/**
 * Cross-language conformance cases. Each case holds one `input.txt` per
 * language and the scan result that language's adapter must produce for it.
 * The schema checks in `worker/scanner-worker-conformance.test.ts` prove the
 * shape of a worker response; these cases prove its meaning: canonical IDs,
 * UTF-16 ranges, repeated links, and parse failures.
 */
const CORPUS_ROOT = resolve(import.meta.dir, "../../../test-fixtures/scanner-conformance");

/** The path each adapter scans the input as. The `.txt` input stays unformatted. */
const SCANNED_PATH: Readonly<Record<CodeLanguage, string>> = {
  typescript: "input.ts",
  swift: "Input.swift",
  dart: "input.dart",
  rust: "input.rs",
  go: "input.go",
  javascript: "input.js",
};

const cases = readdirSync(CORPUS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

test("the conformance corpus has cases", () => {
  expect(cases.length).toBeGreaterThan(0);
});

for (const name of cases) {
  describe(`conformance case ${name}`, () => {
    test("covers every supported language", () => {
      const languages = readdirSync(join(CORPUS_ROOT, name)).toSorted();
      expect(languages).toEqual([...KNOWN_CODE_LANGUAGES].toSorted());
    });

    for (const language of KNOWN_CODE_LANGUAGES) {
      test(`${language} adapter produces the expected scan result`, () => {
        const caseDir = join(CORPUS_ROOT, name, language);
        const content = readFileSync(join(caseDir, "input.txt"), "utf8");
        const expectedPath = join(caseDir, "expected.json");
        const relPath = SCANNED_PATH[language];

        const { codeFiles } = scanCodeFiles(
          caseDir,
          [{ language, relPath }],
          { [language]: { patterns: [relPath] } },
          () => ({ ok: true, content }),
        );

        expect(existsSync(expectedPath)).toBe(true);
        expect(codeFiles).toEqual([JSON.parse(readFileSync(expectedPath, "utf8"))]);
      });

      test(`${language} adapter locates symbols at their name and links at their target`, () => {
        const caseDir = join(CORPUS_ROOT, name, language);
        const content = readFileSync(join(caseDir, "input.txt"), "utf8");
        const relPath = SCANNED_PATH[language];

        const { codeFiles } = scanCodeFiles(
          caseDir,
          [{ language, relPath }],
          { [language]: { patterns: [relPath] } },
          () => ({ ok: true, content }),
        );

        const scan = codeFiles[0];
        expect(scan).toBeDefined();
        for (const symbol of [...(scan?.symbols ?? []), ...(scan?.undocumentedSymbols ?? [])]) {
          expect({ line: symbol.location.line, column: symbol.location.column }).toEqual(
            symbol.nameRange?.start ?? {
              line: symbol.location.line,
              column: symbol.location.column,
            },
          );
        }
        for (const link of scan?.links ?? []) {
          expect({ line: link.location.line, column: link.location.column }).toEqual(
            link.targetRange?.start ?? { line: link.location.line, column: link.location.column },
          );
        }
      });
    }
  });
}
