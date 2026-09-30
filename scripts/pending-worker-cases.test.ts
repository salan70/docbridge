import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import commonOutputSchema from "../schemas/common-output.schema.json";
import scannerWorkerSchema from "../schemas/scanner-worker.schema.json";

/**
 * Drives the scanner-conformance cases of languages whose worker exists but
 * whose language ID is not registered yet (see
 * `test-fixtures/pending-languages/README.md`). Each worker is started with
 * its source-checkout command, exactly as the runtime-backed resolver will
 * start it once the language is registered, and its response is checked
 * against the worker protocol schema and the case's `expected.json`.
 *
 * A language directory that does not exist is skipped; a runtime that is
 * missing from `PATH` fails the case, as the Swift and Dart suites do.
 */

const repoRoot = resolve(import.meta.dir, "..");
const PENDING_ROOT = join(repoRoot, "test-fixtures", "pending-languages");

type PendingLanguage = "python" | "ruby" | "java";

const SCANNED_PATH: Readonly<Record<PendingLanguage, string>> = {
  python: "input.py",
  ruby: "input.rb",
  java: "Input.java",
};

/** Source-checkout commands; the last element is the bundled entrypoint. */
const WORKER_COMMAND: Readonly<Record<PendingLanguage, readonly string[]>> = {
  python: [
    "python3",
    "-I",
    "-S",
    join(repoRoot, "packages/python-scanner/docbridge_python_scanner.py"),
  ],
  ruby: [
    "ruby",
    "--disable=gems,did_you_mean,error_highlight",
    "-W0",
    join(repoRoot, "packages/ruby-scanner/bin/docbridge-ruby-scanner"),
  ],
  java: [
    "java",
    "-Xshare:auto",
    "-XX:TieredStopAtLevel=1",
    "-XX:+UseSerialGC",
    "-jar",
    join(repoRoot, "packages/java-scanner/build/docbridge-java-scanner.jar"),
  ],
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(commonOutputSchema);
const validateResponse = ajv.compile({
  $schema: scannerWorkerSchema.$schema,
  $defs: scannerWorkerSchema.$defs,
  $ref: "#/$defs/response",
});

type Position = { line: number; column: number };
type Located = {
  location: Position;
  nameRange?: { start: Position };
  targetRange?: { start: Position };
};
type ResponseFile = {
  filePath: string;
  symbols: Located[];
  undocumentedSymbols: Located[];
  links: Located[];
  diagnostics: unknown[];
};

function runWorker(language: PendingLanguage, filePath: string, content: string): unknown {
  const [executable, ...args] = WORKER_COMMAND[language];
  const request = {
    schemaVersion: 1,
    requestId: `pending-${language}`,
    language,
    projectRoot: repoRoot,
    files: [{ filePath, content }],
    options: {},
  };
  const result = spawnSync(executable as string, args, {
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(
    result.error,
    `cannot start ${executable}: ${result.error?.message ?? ""}`,
  ).toBeUndefined();
  expect(result.status, `worker exited ${result.status}: ${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout);
}

for (const language of Object.keys(SCANNED_PATH) as PendingLanguage[]) {
  const languageRoot = join(PENDING_ROOT, language);
  if (!existsSync(languageRoot)) {
    continue;
  }
  const cases = readdirSync(languageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  describe(`pending ${language} worker`, () => {
    test("has the four conformance cases", () => {
      expect(cases).toEqual([
        "annotated-declaration",
        "duplicate-link",
        "non-ascii-range",
        "parse-error",
      ]);
    });

    for (const name of cases) {
      test(`${name}: response matches expected.json and the protocol schema`, () => {
        const caseDir = join(languageRoot, name);
        const content = readFileSync(join(caseDir, "input.txt"), "utf8");
        const expected = JSON.parse(
          readFileSync(join(caseDir, "expected.json"), "utf8"),
        ) as ResponseFile;
        const response = runWorker(language, SCANNED_PATH[language], content) as {
          schemaVersion: number;
          requestId: string;
          language: string;
          files: ResponseFile[];
        };

        expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
        expect(response.schemaVersion).toBe(1);
        expect(response.requestId).toBe(`pending-${language}`);
        expect(response.language).toBe(language);
        expect(response.files).toEqual([expected]);

        const scan = response.files[0] as ResponseFile;
        // A location carries the file path; compare only its position.
        for (const symbol of [...scan.symbols, ...scan.undocumentedSymbols]) {
          const position = { line: symbol.location.line, column: symbol.location.column };
          expect(position).toEqual(symbol.nameRange?.start ?? position);
        }
        for (const link of scan.links) {
          const position = { line: link.location.line, column: link.location.column };
          expect(position).toEqual(link.targetRange?.start ?? position);
        }
      });
    }
  });
}
