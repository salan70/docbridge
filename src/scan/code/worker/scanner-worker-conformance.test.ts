import { expect, test } from "bun:test";

import Ajv2020 from "ajv/dist/2020";

import commonOutputSchema from "../../../../schemas/common-output.schema.json";
import scannerWorkerSchema from "../../../../schemas/scanner-worker.schema.json";
import { scanTypeScript } from "../typescript";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(commonOutputSchema);
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
