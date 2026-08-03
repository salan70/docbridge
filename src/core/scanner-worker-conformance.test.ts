import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import scannerWorkerSchema from "../../schemas/scanner-worker.schema.json";
import type { ScannerWorkerRequest } from "./scanner-worker";
import { scanTypeScript } from "./typescript";

const repoRoot = resolve(import.meta.dir, "..", "..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRequest = ajv.compile({
  $schema: scannerWorkerSchema.$schema,
  $defs: scannerWorkerSchema.$defs,
  $ref: "#/$defs/request",
});
const validateResponse = ajv.compile({
  $schema: scannerWorkerSchema.$schema,
  $defs: scannerWorkerSchema.$defs,
  $ref: "#/$defs/response",
});

test("TypeScript scan results conform to the shared response schema", () => {
  const scan = scanTypeScript(
    "src/auth.ts",
    "/** @doc docs/auth.md#auth */\nexport function authenticate() {}\n",
  );
  const file = {
    filePath: scan.filePath,
    symbols: scan.symbols,
    undocumentedSymbols: scan.undocumentedSymbols,
    links: scan.links,
    diagnostics: scan.diagnostics,
  };
  const response = {
    schemaVersion: 1,
    requestId: "conformance-typescript",
    language: "typescript",
    files: [file],
  };

  expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
});

for (const fixture of [
  {
    language: "swift" as const,
    executable: resolve(repoRoot, "packages/swift-scanner/.build/debug/docbridge-swift-scanner"),
    filePath: "Sources/Auth.swift",
    content: "public struct Auth {}\n",
  },
  {
    language: "dart" as const,
    executable: resolve(repoRoot, "packages/dart-scanner/bin/docbridge_dart_scanner"),
    filePath: "lib/auth.dart",
    content: "class Auth {}\n",
  },
]) {
  test(`${fixture.language} worker conforms to the shared request and response schema`, () => {
    const request: ScannerWorkerRequest = {
      schemaVersion: 1,
      requestId: `conformance-${fixture.language}`,
      language: fixture.language,
      projectRoot: repoRoot,
      files: [{ filePath: fixture.filePath, content: fixture.content }],
      options: {},
    };

    expect(validateRequest(request), JSON.stringify(validateRequest.errors)).toBe(true);

    const process = spawnSync(fixture.executable, [], {
      input: JSON.stringify(request),
      encoding: "utf8",
    });
    expect(process.status, process.stderr).toBe(0);
    const response: unknown = JSON.parse(process.stdout);
    expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
  });
}
