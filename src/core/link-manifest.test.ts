import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import manifestSchema from "../../schemas/docbridge.links.schema.json";
import { LINK_MANIFEST_FILE_NAME, loadLinkManifest, resolveLinkManifest } from "./link-manifest";

function expectOk(rawText: string | undefined) {
  const result = resolveLinkManifest(rawText);
  if (!result.ok) {
    throw new Error(`expected a manifest, got ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
}

test("loadLinkManifest reports a manifest path it cannot read and stops", () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-manifest-"));
  mkdirSync(join(root, LINK_MANIFEST_FILE_NAME));
  try {
    const result = loadLinkManifest(root);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("config_file_invalid");
    expect(result.diagnostics[0]?.target).toBe(LINK_MANIFEST_FILE_NAME);
    expect(result.diagnostics[0]?.message).toContain(`Failed to read ${LINK_MANIFEST_FILE_NAME}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveLinkManifest accepts an empty links array", () => {
  const result = expectOk('{ "links": [] }');

  expect(result.manifest.entries).toEqual([]);
});

test("resolveLinkManifest records the position of the entry and of each target", () => {
  const text = [
    '{ "links": [',
    '  { "code": "src/a.ts#A",',
    '    "doc": "docs/a.md#b" }',
    "] }",
  ].join("\n");

  const entry = expectOk(text).manifest.entries[0];

  expect(entry?.location).toEqual({ filePath: LINK_MANIFEST_FILE_NAME, line: 2, column: 3 });
  expect(entry?.codeRange?.start).toEqual({ line: 2, column: 14 });
  expect(entry?.docRange?.start).toEqual({ line: 3, column: 13 });
});

test("resolveLinkManifest reports a parse failure as config_file_invalid with a position", () => {
  const result = resolveLinkManifest('{ "links": [], }');

  expect(result.ok).toBe(false);
  const diagnostic = result.diagnostics[0];
  expect(diagnostic?.code).toBe("config_file_invalid");
  expect(diagnostic?.severity).toBe("error");
  expect(diagnostic?.target).toBe(LINK_MANIFEST_FILE_NAME);
  expect(diagnostic?.location?.filePath).toBe(LINK_MANIFEST_FILE_NAME);
  expect(diagnostic?.location?.line).toBe(1);
});

test.each([
  ['{ "links": [], "extra": 1 }', "extra"],
  ['{ "links": [{ "code": "src/a.ts#A", "doc": "docs/a.md#b", "why": 1 }] }', "links[0].why"],
])("resolveLinkManifest reports %s as an unknown key", (text, key) => {
  const result = resolveLinkManifest(text);

  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe("config_unknown_key");
  expect(result.diagnostics[0]?.message).toContain(key);
  expect(result.diagnostics[0]?.location?.line).toBe(1);
});

test.each([
  ["[]", "a root that is not an object"],
  ['{ "links": {} }', "links that is not an array"],
  ["{}", "a missing links key"],
  ['{ "links": [1] }', "an entry that is not an object"],
  ['{ "links": [{ "doc": "docs/a.md#b" }] }', "a missing code key"],
  ['{ "links": [{ "code": "src/a.ts#A" }] }', "a missing doc key"],
  ['{ "links": [{ "code": 1, "doc": "docs/a.md#b" }] }', "a code that is not a string"],
  ['{ "links": [{ "code": "src/a.ts#A", "doc": "docs/a.md#b", "note": 1 }] }', "a non-string note"],
])("resolveLinkManifest reports config_invalid_value for %s (%s)", (text) => {
  const result = resolveLinkManifest(text);

  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe("config_invalid_value");
  expect(result.diagnostics[0]?.target).toBe(LINK_MANIFEST_FILE_NAME);
  expect(result.diagnostics[0]?.location).toBeDefined();
});

test.each([
  [
    '{ "links": [],\n  "links": [{ "code": "src/a.ts#A", "doc": "docs/a.md#b" }] }',
    "links",
    { line: 2, column: 3 },
  ],
  [
    '{ "links": [{ "code": "src/a.ts#A",\n  "code": "src/b.ts#B", "doc": "docs/a.md#b" }] }',
    "links[0].code",
    { line: 2, column: 3 },
  ],
])("resolveLinkManifest rejects a duplicate key in %s", (text, path, start) => {
  const result = resolveLinkManifest(text);

  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  expect(diagnostic?.code).toBe("config_invalid_value");
  expect(diagnostic?.message).toBe(`Duplicate key ${path} in ${LINK_MANIFEST_FILE_NAME}.`);
  expect(diagnostic?.location).toEqual({ filePath: LINK_MANIFEST_FILE_NAME, ...start });
});

test("resolveLinkManifest reports a bad target as invalid_link_target without failing", () => {
  const text = [
    "{",
    '  "links": [',
    '    { "code": "src/a.ts", "doc": "docs/a.md#b" },',
    '    { "code": "src/c.ts#C", "doc": "docs/c.md#d" }',
    "  ]",
    "}",
  ].join("\n");

  const result = resolveLinkManifest(text);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected the manifest to load");
  }
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("invalid_link_target");
  expect(result.diagnostics[0]?.target).toBe("src/a.ts");
  expect(result.diagnostics[0]?.location).toEqual({
    filePath: LINK_MANIFEST_FILE_NAME,
    line: 3,
    column: 16,
  });
  expect(result.manifest.entries.map((entry) => entry.codeEndpoint)).toEqual(["src/c.ts#C"]);
});

test("resolveLinkManifest reports every shape error in one pass", () => {
  const text = '{ "links": [{ "code": 1, "doc": 2 }] }';

  const result = resolveLinkManifest(text);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "config_invalid_value",
    "config_invalid_value",
  ]);
});

const validateManifestSchema = new Ajv2020({ allErrors: true, strict: true }).compile(
  manifestSchema,
);

test("published manifest schema accepts a declared link", () => {
  const manifest = {
    $schema: "./schemas/docbridge.links.schema.json",
    links: [{ code: "src/auth.ts#AuthService.login", doc: "docs/auth.md#login-flow", note: "why" }],
  };

  expect(validateManifestSchema(manifest), JSON.stringify(validateManifestSchema.errors)).toBe(
    true,
  );
});

test.each([
  [{ links: [{ code: "src/a.ts#A", doc: "docs/a.md#b", why: 1 }] }, "an unknown entry key"],
  [{ links: [{ code: "src/a.ts#A" }] }, "a missing doc"],
  [{ links: [{ code: "src/a.ts", doc: "docs/a.md#b" }] }, "a code without a fragment"],
  [{ links: [{ code: "src/a.ts#A", doc: "docs/a.md" }] }, "a doc without a fragment"],
  [{ links: [{ code: "/src/a.ts#A", doc: "docs/a.md#b" }] }, "an absolute code path"],
  [{ links: [{ code: "src/a.ts#A", doc: "docs/a.txt#b" }] }, "a doc that is not Markdown"],
  [{ links: [], extra: true }, "an unknown top-level key"],
  [{}, "a missing links key"],
])("published manifest schema rejects %o (%s)", (manifest) => {
  expect(validateManifestSchema(manifest)).toBe(false);
});
