import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import commonOutputSchema from "../../../../schemas/common-output.schema.json";
import scannerWorkerSchema from "../../../../schemas/scanner-worker.schema.json";
import { scanTypeScript } from "../typescript";
import { resolveRuntimeWorkerCommand } from "./runtime-worker";
import { runScannerWorkerProcess, type ScannerWorkerRequest } from "./scanner-worker";

const repoRoot = resolve(import.meta.dir, "..", "..", "..", "..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(commonOutputSchema);
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

const CORPUS_ROOT = resolve(repoRoot, "test-fixtures/scanner-conformance");

/**
 * One file per scanner-conformance case, holding that case's `language` input
 * under `<case>/<fileName>`, so a response covers parse errors and repeated
 * links as well as plain declarations.
 */
function corpusFiles(language: string, fileName: string): ScannerWorkerRequest["files"] {
  return readdirSync(CORPUS_ROOT)
    .toSorted()
    .map((name) => ({
      filePath: `${name}/${fileName}`,
      content: readFileSync(join(CORPUS_ROOT, name, language, "input.txt"), "utf8"),
    }));
}

for (const fixture of [
  {
    language: "python" as const,
    filePath: "src/auth.py",
    content: "class Auth:\n    pass\n",
    corpusName: "input.py",
  },
  {
    language: "ruby" as const,
    filePath: "lib/auth.rb",
    content: "class Auth; end\n",
    corpusName: "input.rb",
  },
  {
    language: "java" as const,
    filePath: "src/main/java/auth/Auth.java",
    content: "package auth;\n\npublic class Auth {}\n",
    corpusName: "Input.java",
  },
]) {
  test(`${fixture.language} runtime worker conforms to the shared request and response schema`, () => {
    const request: ScannerWorkerRequest = {
      schemaVersion: 1,
      requestId: `conformance-${fixture.language}`,
      language: fixture.language,
      projectRoot: repoRoot,
      files: [
        { filePath: fixture.filePath, content: fixture.content },
        ...corpusFiles(fixture.language, fixture.corpusName),
      ],
      options: {},
    };
    const resolution = resolveRuntimeWorkerCommand(fixture.language, { projectRoot: repoRoot });
    if (!resolution.ok) {
      throw new Error(resolution.diagnostic.message);
    }

    expect(validateRequest(request), JSON.stringify(validateRequest.errors)).toBe(true);

    const result = runScannerWorkerProcess({
      command: resolution.command,
      stripEnv: resolution.stripEnv,
      stdin: JSON.stringify(request),
    });
    if (!result.ok) {
      throw new Error(`cannot start ${resolution.command[0]}: ${String(result.error)}`);
    }
    expect(result.exitCode, result.stderr).toBe(0);
    const response = JSON.parse(result.stdout) as {
      requestId: string;
      language: string;
      files: { filePath: string }[];
    };
    expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
    expect(response).toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      language: fixture.language,
    });
    expect(response.files.map((file) => file.filePath)).toEqual(
      request.files.map((file) => file.filePath),
    );
  });
}

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
  {
    language: "rust" as const,
    executable: resolve(repoRoot, "packages/rust-scanner/target/debug/docbridge-rust-scanner"),
    filePath: "src/auth.rs",
    content: "pub struct Auth;\n",
  },
  {
    language: "go" as const,
    executable: resolve(repoRoot, "packages/go-scanner/bin/docbridge-go-scanner"),
    filePath: "internal/auth/auth.go",
    content: "package auth\n\ntype Auth struct{}\n",
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
