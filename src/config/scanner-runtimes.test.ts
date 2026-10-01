import { expect, test } from "bun:test";

import Ajv2020 from "ajv/dist/2020";

import configSchema from "../../schemas/docbridge.schema.json";
import { resolveConfig } from "./config";
import { RUNTIME_WORKER_LANGUAGES } from "./scanner-runtimes";

const BASE = {
  include: {
    code: { typescript: { patterns: ["src/**/*.ts"] } },
    docs: ["docs/**/*.md"],
  },
};

const validateConfigSchema = new Ajv2020({ allErrors: true, strict: true }).compile(configSchema);

test("resolveConfig accepts a runtime command for each runtime-backed language", () => {
  const scanners = {
    python: { command: ["/opt/py/bin/python3"] },
    ruby: { command: ["tools/ruby"] },
    java: { command: ["/usr/lib/jvm/17/bin/java"] },
  };

  const result = resolveConfig(JSON.stringify({ ...BASE, scanners }));

  expect(result.diagnostics).toEqual([]);
  expect(result.config.scanners).toEqual(scanners);
});

test("resolveConfig leaves scanners unset when the configuration has none", () => {
  const result = resolveConfig(JSON.stringify(BASE));

  expect(result.ok).toBe(true);
  expect(result.config.scanners).toBeUndefined();
});

test("resolveConfig rejects a scanner runtime for a language without a runtime-backed worker", () => {
  const result = resolveConfig(
    JSON.stringify({ ...BASE, scanners: { go: { command: ["/usr/local/go/bin/go"] } } }),
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual([
    {
      severity: "error",
      code: "config_unknown_key",
      target: "scanners.go",
      message: "Unknown scanner runtime: go. Supported runtimes: python, ruby, java.",
    },
  ]);
});

test("resolveConfig rejects an unknown key inside a scanner runtime", () => {
  const result = resolveConfig(
    JSON.stringify({ ...BASE, scanners: { python: { command: ["python3"], args: ["-X"] } } }),
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toMatchObject([
    { code: "config_unknown_key", target: "scanners.python.args" },
  ]);
});

test.each([
  ["an array", ["python3"], "scanners"],
  ["a string", "python3", "scanners"],
  ["null", null, "scanners"],
])("resolveConfig rejects scanners given as %s", (_label, scanners, target) => {
  const result = resolveConfig(JSON.stringify({ ...BASE, scanners }));

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toMatchObject([{ code: "config_invalid_value", target }]);
});

test.each([
  ["a command array instead of an entry", { python: ["python3"] }, "scanners.python"],
  ["an entry without a command", { python: {} }, "scanners.python.command"],
  ["a string command", { ruby: { command: "ruby" } }, "scanners.ruby.command"],
  ["an empty command", { java: { command: [] } }, "scanners.java.command"],
  ["a non-string argument", { python: { command: ["py", 3] } }, "scanners.python.command"],
  ["an empty argument", { python: { command: [""] } }, "scanners.python.command"],
])("resolveConfig rejects %s", (_label, scanners, target) => {
  const result = resolveConfig(JSON.stringify({ ...BASE, scanners }));

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toMatchObject([{ code: "config_invalid_value", target }]);
});

test("published config schema lists the runtime-backed languages under scanners", () => {
  expect(Object.keys(configSchema.properties.scanners.properties)).toEqual([
    ...RUNTIME_WORKER_LANGUAGES,
  ]);
  expect(
    validateConfigSchema({
      ...BASE,
      scanners: { python: { command: ["py", "-3.12"] }, java: { command: ["java"] } },
    }),
    JSON.stringify(validateConfigSchema.errors),
  ).toBe(true);
});

test.each([
  ["an unknown language", { go: { command: ["go"] } }],
  ["an unknown entry key", { python: { command: ["python3"], args: [] } }],
  ["an entry without a command", { python: {} }],
  ["an empty command", { java: { command: [] } }],
  ["an empty argument", { ruby: { command: [""] } }],
  ["a non-string argument", { ruby: { command: [3] } }],
])("published config schema rejects scanners with %s", (_label, scanners) => {
  expect(validateConfigSchema({ ...BASE, scanners })).toBe(false);
});
