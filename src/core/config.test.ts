import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, resolveConfig } from "./config";

const TS_CONFIG = {
  include: {
    code: { typescript: { patterns: ["src/**/*.ts"] } },
    docs: ["docs/**/*.md"],
  },
};

function codes(result: ReturnType<typeof resolveConfig>): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("resolveConfig rejects a missing config file", () => {
  const result = resolveConfig(undefined);
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]).toMatchObject({ code: "config_file_invalid" });
});

test("resolveConfig accepts a language-keyed config", () => {
  const result = resolveConfig(
    JSON.stringify({
      $schema: "./schemas/docbridge.schema.json",
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/specs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.config).toEqual({
    include: {
      code: { typescript: { patterns: ["src/**/*.ts"] } },
      docs: ["docs/specs/**/*.md"],
    },
  });
});

test("resolveConfig accepts a language entry with a visibility option", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: {
        code: { swift: { patterns: ["Sources/**/*.swift"], visibility: ["public", "open"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.config.include.code.swift).toEqual({
    patterns: ["Sources/**/*.swift"],
    visibility: ["public", "open"],
  });
});

test("resolveConfig rejects unsupported visibility options for a language", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: {
        code: { swift: { patterns: ["Sources/**/*.swift"], visibility: ["private"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe("config_invalid_value");
  expect(result.diagnostics[0]?.message).toContain("Unsupported swift visibility: private");
});

test("resolveConfig accepts a dart entry with the public visibility option", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: {
        code: { dart: { patterns: ["lib/**/*.dart"], visibility: ["public"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.config.include.code.dart).toEqual({
    patterns: ["lib/**/*.dart"],
    visibility: ["public"],
  });
});

test("resolveConfig rejects unsupported dart visibility options", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: {
        code: { dart: { patterns: ["lib/**/*.dart"], visibility: ["private"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe("config_invalid_value");
  expect(result.diagnostics[0]?.message).toContain("Unsupported dart visibility: private");
});

test("resolveConfig rejects the old include.code array form", () => {
  const result = resolveConfig(
    JSON.stringify({ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] } }),
  );
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_invalid_value");
});

test("resolveConfig rejects an unknown language ID", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: { code: { kotlin: { patterns: ["src/**/*.kt"] } }, docs: ["docs/**/*.md"] },
    }),
  );
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_invalid_value");
});

test("resolveConfig rejects a shorthand array language entry", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: { code: { swift: ["Sources/**/*.swift"] }, docs: ["docs/**/*.md"] },
    }),
  );
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_invalid_value");
});

test("resolveConfig rejects an unknown key inside a language entry", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"], extra: true } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_unknown_key");
});

test("resolveConfig reports config_file_invalid for unparseable JSON", () => {
  const result = resolveConfig("{ not json");
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    code: "config_file_invalid",
    target: "docbridge.config.json",
  });
});

test("resolveConfig reports config_unknown_key for unknown top-level keys", () => {
  const result = resolveConfig(JSON.stringify({ ...TS_CONFIG, extra: true }));
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_unknown_key");
});

test("resolveConfig reports config_unknown_key for unknown include keys", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: { ...TS_CONFIG.include, tests: ["t/*.ts"] },
    }),
  );
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_unknown_key");
});

test.each([
  [{ include: { docs: ["docs/**/*.md"] } }, "missing include.code"],
  [{ include: { code: { typescript: { patterns: ["src/**/*.ts"] } } } }, "missing include.docs"],
  [{ include: { code: {}, docs: ["docs/**/*.md"] } }, "empty include.code"],
  [
    { include: { code: { typescript: { patterns: [] } }, docs: ["docs/**/*.md"] } },
    "empty patterns",
  ],
  [{ include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: [] } }, "empty docs"],
  [
    { include: { code: { typescript: { patterns: [1] } }, docs: ["docs/**/*.md"] } },
    "non-string pattern",
  ],
  [{ include: "x" }, "include not an object"],
  [{}, "missing include"],
  [
    { include: { code: { typescript: { patterns: ["src/**/*.md"] } }, docs: ["docs/**/*.md"] } },
    "typescript wrong suffix",
  ],
  [
    { include: { code: { typescript: { patterns: ["src/**/*.d.ts"] } }, docs: ["docs/**/*.md"] } },
    "typescript .d.ts suffix",
  ],
  [
    { include: { code: { swift: { patterns: ["Sources/**/*.ts"] } }, docs: ["docs/**/*.md"] } },
    "swift wrong suffix",
  ],
  [
    { include: { code: { dart: { patterns: ["lib/**/*.ts"] } }, docs: ["docs/**/*.md"] } },
    "dart wrong suffix",
  ],
  [
    {
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"], visibility: "public" } },
        docs: ["docs/**/*.md"],
      },
    },
    "visibility not an array",
  ],
  [
    {
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"], visibility: ["public"] } },
        docs: ["docs/**/*.md"],
      },
    },
    "typescript visibility unsupported",
  ],
  [
    { include: { code: { typescript: { patterns: ["src/**/*.ts"] } }, docs: ["docs/**/*.ts"] } },
    "docs wrong suffix",
  ],
  [
    { include: { code: { typescript: { patterns: ["/src/**/*.ts"] } }, docs: ["docs/**/*.md"] } },
    "absolute code path",
  ],
  [
    { include: { code: { typescript: { patterns: ["../src/**/*.ts"] } }, docs: ["docs/**/*.md"] } },
    "parent traversal",
  ],
  [{ ...TS_CONFIG, $schema: 5 }, "non-string schema"],
])("resolveConfig reports config_invalid_value for %s", (raw) => {
  const result = resolveConfig(JSON.stringify(raw));
  expect(result.ok).toBe(false);
  expect(codes(result)).toContain("config_invalid_value");
});

test("loadConfig reads docbridge.config.json from project root", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-config-"));
  try {
    writeFileSync(join(root, "docbridge.config.json"), JSON.stringify(TS_CONFIG));
    const result = loadConfig(root);
    expect(result.ok).toBe(true);
    expect(result.config).toEqual(TS_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig reports config_file_invalid when no config file exists", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-config-"));
  try {
    const result = loadConfig(root);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: "config_file_invalid" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig does not report a false overlap for a valid single-language config", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-overlap-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "docbridge.config.json"), JSON.stringify(TS_CONFIG));
    const result = loadConfig(root);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the actual repo root config files validate cleanly", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const root = loadConfig(repoRoot);
  expect(root.ok).toBe(true);
  expect(root.diagnostics).toEqual([]);

  const example = loadConfig(join(repoRoot, "examples", "typescript"));
  expect(example.ok).toBe(true);
  expect(example.diagnostics).toEqual([]);
});
