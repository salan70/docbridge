import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, resolveConfig } from "./config";

const DEFAULT_CONFIG = {
  include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] },
};

test("resolveConfig returns default config when no file is present", () => {
  const result = resolveConfig(undefined);
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.config).toEqual(DEFAULT_CONFIG);
});

test("resolveConfig accepts a valid root-style config", () => {
  const result = resolveConfig(
    JSON.stringify({
      $schema: "./schemas/speclink.schema.json",
      include: { code: ["src/**/*.ts"], docs: ["docs/specs/**/*.md"] },
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.config).toEqual({
    include: { code: ["src/**/*.ts"], docs: ["docs/specs/**/*.md"] },
  });
});

test("resolveConfig accepts a valid example-style config", () => {
  const result = resolveConfig(
    JSON.stringify({
      $schema: "../../schemas/speclink.schema.json",
      include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] },
    }),
  );
  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("resolveConfig reports config_file_invalid for unparseable JSON", () => {
  const result = resolveConfig("{ not json");
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    severity: "error",
    code: "config_file_invalid",
    target: "speclink.config.json",
  });
});

test("resolveConfig reports config_unknown_key for unknown top-level keys", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] },
      extra: true,
    }),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "config_unknown_key")).toBe(true);
});

test("resolveConfig reports config_unknown_key for unknown include keys", () => {
  const result = resolveConfig(
    JSON.stringify({
      include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"], tests: ["t/*.ts"] },
    }),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "config_unknown_key")).toBe(true);
});

test.each([
  [{ include: { docs: ["docs/**/*.md"] } }, "missing include.code"],
  [{ include: { code: ["src/**/*.ts"] } }, "missing include.docs"],
  [{ include: { code: [], docs: ["docs/**/*.md"] } }, "empty include.code"],
  [{ include: { code: ["src/**/*.ts"], docs: [] } }, "empty include.docs"],
  [{ include: { code: [1], docs: ["docs/**/*.md"] } }, "non-string in code"],
  [{ include: "x" }, "include not an object"],
  [{}, "missing include"],
  [{ include: { code: ["src/**/*.md"], docs: ["docs/**/*.md"] } }, "code wrong suffix"],
  [{ include: { code: ["src/**/*.d.ts"], docs: ["docs/**/*.md"] } }, "code .d.ts suffix"],
  [{ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.ts"] } }, "docs wrong suffix"],
  [{ include: { code: ["/src/**/*.ts"], docs: ["docs/**/*.md"] } }, "absolute code path"],
  [{ include: { code: ["./src/**/*.ts"], docs: ["docs/**/*.md"] } }, "dot-prefixed code path"],
  [{ include: { code: ["../src/**/*.ts"], docs: ["docs/**/*.md"] } }, "parent traversal"],
  [{ include: { code: ["src\\**\\*.ts"], docs: ["docs/**/*.md"] } }, "backslash separator"],
  [{ include: { code: ["src/[a]/*.ts"], docs: ["docs/**/*.md"] } }, "invalid glob syntax"],
  [{ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] }, $schema: 5 }, "non-string schema"],
])("resolveConfig reports config_invalid_value for %s", (raw) => {
  const result = resolveConfig(JSON.stringify(raw));
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "config_invalid_value")).toBe(true);
});

test("loadConfig reads speclink.config.json from project root", () => {
  const root = mkdtempSync(join(tmpdir(), "speclink-config-"));
  try {
    writeFileSync(
      join(root, "speclink.config.json"),
      JSON.stringify({ include: { code: ["src/**/*.ts"], docs: ["docs/**/*.md"] } }),
    );
    const result = loadConfig(root);
    expect(result.ok).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig falls back to defaults when no config file exists", () => {
  const root = mkdtempSync(join(tmpdir(), "speclink-config-"));
  try {
    const result = loadConfig(root);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the actual repo root config files validate cleanly", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const root = loadConfig(repoRoot);
  expect(root.ok).toBe(true);
  expect(root.diagnostics).toEqual([]);

  const example = loadConfig(join(repoRoot, "examples", "basic"));
  expect(example.ok).toBe(true);
  expect(example.diagnostics).toEqual([]);
});
