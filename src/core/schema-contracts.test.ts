import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "schemas", name), "utf8"),
  ) as Record<string, unknown>;
}

test("graph and context schemas share one diagnostic definition", () => {
  const common = readSchema("common-output.schema.json");
  const graph = readSchema("graph-output.schema.json") as {
    properties: { diagnostics: { items: { $ref: string } } };
    $defs?: unknown;
  };
  const context = readSchema("context-output.schema.json") as {
    properties: { diagnostics: { items: { $ref: string } } };
    $defs?: unknown;
  };

  expect(common).toHaveProperty("$defs.diagnostic");
  expect(graph.properties.diagnostics.items.$ref).toBe(
    "common-output.schema.json#/$defs/diagnostic",
  );
  expect(context.properties.diagnostics.items.$ref).toBe(
    "common-output.schema.json#/$defs/diagnostic",
  );
  expect(graph.$defs).toBeUndefined();
  expect(context.$defs).toBeUndefined();
});

test("worker schema reuses common output definitions", () => {
  const worker = readSchema("scanner-worker.schema.json") as {
    $defs: Record<string, unknown> & {
      codeSymbol: { properties: { location: { $ref: string }; nameRange: { $ref: string } } };
      link: { properties: { location: { $ref: string }; targetRange: { $ref: string } } };
      responseFile: { properties: { diagnostics: { items: { $ref: string } } } };
    };
  };

  expect(worker.$defs.position).toBeUndefined();
  expect(worker.$defs.range).toBeUndefined();
  expect(worker.$defs.location).toBeUndefined();
  expect(worker.$defs.diagnostic).toBeUndefined();
  expect(worker.$defs.codeSymbol.properties.location.$ref).toBe(
    "common-output.schema.json#/$defs/location",
  );
  expect(worker.$defs.codeSymbol.properties.nameRange.$ref).toBe(
    "common-output.schema.json#/$defs/range",
  );
  expect(worker.$defs.link.properties.location.$ref).toBe(
    "common-output.schema.json#/$defs/location",
  );
  expect(worker.$defs.link.properties.targetRange.$ref).toBe(
    "common-output.schema.json#/$defs/range",
  );
  expect(worker.$defs.responseFile.properties.diagnostics.items.$ref).toBe(
    "common-output.schema.json#/$defs/diagnostic",
  );
});
