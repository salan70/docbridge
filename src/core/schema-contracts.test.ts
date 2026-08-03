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
