import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { createScannerWorkerAdapter, scanCodeFiles } from "../../src/scan/code/dispatch";
import { type GateLanguage, type GateTarget, firstDifference, formatResultLine } from "./compare";
import { parseTarget, resolveWorkerCommand } from "./target";

/**
 * Runs the scanner conformance corpus for Swift and Dart through one worker
 * target, the shipped worker or the candidate binary, and compares each result
 * with the case's `expected.json`.
 */
const CORPUS_ROOT = resolve(import.meta.dir, "../../test-fixtures/scanner-conformance");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

/** The path each adapter scans the input as, as in `conformance.test.ts`. */
const SCANNED_PATH: Readonly<Record<GateLanguage, string>> = {
  swift: "Input.swift",
  dart: "input.dart",
};

async function runCase(
  target: GateTarget,
  name: string,
  language: GateLanguage,
): Promise<string | undefined> {
  const caseDir = join(CORPUS_ROOT, name, language);
  const content = readFileSync(join(caseDir, "input.txt"), "utf8");
  const expected: unknown = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8"));
  const relPath = SCANNED_PATH[language];
  const command = resolveWorkerCommand(target, language);
  const { codeFiles } = await scanCodeFiles(
    caseDir,
    [{ language, relPath }],
    { [language]: { patterns: [relPath] } },
    () => ({ ok: true, content }),
    { adapters: { [language]: createScannerWorkerAdapter(language, () => command) } },
  ).promise;
  return firstDifference([expected], codeFiles);
}

async function main(): Promise<number> {
  const target = parseTarget(process.argv[2]);
  const cases = readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  let failed = false;
  for (const name of cases) {
    for (const language of LANGUAGES) {
      const difference = await runCase(target, name, language);
      console.log(formatResultLine(`${name}/${language}`, difference));
      failed ||= difference !== undefined;
    }
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
