import { expect, test } from "bun:test";
import { join } from "node:path";

import { check } from "../src/core/resolver";
import {
  compareAuditBaseline,
  diffAuditBaseline,
  formatBaselineDiff,
  normalizeAuditKeys,
  parseBaseline,
} from "./check-audit-baseline";

const ROOT = join(import.meta.dir, "..");

test("normalizeAuditKeys keeps only audit codes and drops message and location", () => {
  const keys = normalizeAuditKeys([
    {
      code: "undocumented_symbol",
      target: "src/core/resolver.ts#check",
      message: "Exported symbol src/core/resolver.ts#check has no @doc annotation.",
      location: { filePath: "src/core/resolver.ts", line: 195, column: 1 },
    },
    {
      code: "doc_file_not_found",
      target: "docs/missing.md#gone",
      message: "Documentation file not found.",
    },
    {
      code: "unlinked_doc_section",
      target: "docs/specs/cli.md#error-guidance",
      message: "Doc section docs/specs/cli.md#error-guidance has no @code annotation.",
      location: { filePath: "docs/specs/cli.md", line: 59, column: 1 },
    },
  ]);

  expect(keys).toEqual([
    { code: "undocumented_symbol", target: "src/core/resolver.ts#check" },
    { code: "unlinked_doc_section", target: "docs/specs/cli.md#error-guidance" },
  ]);
});

test("normalizeAuditKeys sorts by code then target and collapses duplicate keys", () => {
  const keys = normalizeAuditKeys([
    { code: "unlinked_doc_section", target: "docs/b.md#z" },
    { code: "undocumented_symbol", target: "src/b.ts#b" },
    { code: "undocumented_symbol", target: "src/a.ts#a" },
    {
      code: "undocumented_symbol",
      target: "src/a.ts#a",
      message: "duplicate live report with a different message",
      location: { filePath: "src/a.ts", line: 99, column: 1 },
    },
    { code: "unlinked_doc_section", target: "docs/a.md#a" },
  ]);

  expect(keys).toEqual([
    { code: "undocumented_symbol", target: "src/a.ts#a" },
    { code: "undocumented_symbol", target: "src/b.ts#b" },
    { code: "unlinked_doc_section", target: "docs/a.md#a" },
    { code: "unlinked_doc_section", target: "docs/b.md#z" },
  ]);
});

test("diffAuditBaseline reports keys present only in the live set as additions", () => {
  const diff = diffAuditBaseline(
    [
      { code: "undocumented_symbol", target: "src/core/new.ts#added" },
      { code: "undocumented_symbol", target: "src/core/old.ts#kept" },
    ],
    [{ code: "undocumented_symbol", target: "src/core/old.ts#kept" }],
  );

  expect(diff).toEqual({
    added: [{ code: "undocumented_symbol", target: "src/core/new.ts#added" }],
    removed: [],
  });
});

test("diffAuditBaseline reports keys present only in the baseline as removals", () => {
  const diff = diffAuditBaseline(
    [{ code: "unlinked_doc_section", target: "docs/specs/cli.md#help" }],
    [
      { code: "unlinked_doc_section", target: "docs/specs/cli.md#error-guidance" },
      { code: "unlinked_doc_section", target: "docs/specs/cli.md#help" },
    ],
  );

  expect(diff).toEqual({
    added: [],
    removed: [{ code: "unlinked_doc_section", target: "docs/specs/cli.md#error-guidance" }],
  });
});

test("formatBaselineDiff names unreviewed additions and stale removals", () => {
  const report = formatBaselineDiff({
    added: [{ code: "undocumented_symbol", target: "src/core/new.ts#added" }],
    removed: [{ code: "unlinked_doc_section", target: "docs/specs/old.md#gone" }],
  });

  expect(report).toContain("unreviewed audit target");
  expect(report).toContain("undocumented_symbol src/core/new.ts#added");
  expect(report).toContain("stale baseline entry");
  expect(report).toContain("unlinked_doc_section docs/specs/old.md#gone");
});

test("parseBaseline rejects an unknown review class", () => {
  expect(() =>
    parseBaseline({
      version: 1,
      entries: [
        {
          code: "undocumented_symbol",
          target: "src/core/foo.ts#foo",
          class: "not_a_class",
        },
      ],
    }),
  ).toThrow(/unknown review class/i);
});

test("compareAuditBaseline accepts an exact match regardless of entry order", () => {
  const result = compareAuditBaseline(
    [
      {
        code: "unlinked_doc_section",
        target: "docs/specs/cli.md#error-guidance",
        message: "ignored",
        location: { filePath: "docs/specs/cli.md", line: 1, column: 1 },
      },
      {
        code: "undocumented_symbol",
        target: "src/core/foo.ts#foo",
        message: "ignored",
      },
    ],
    parseBaseline({
      version: 1,
      entries: [
        {
          code: "unlinked_doc_section",
          target: "docs/specs/cli.md#error-guidance",
          class: "structural_doc",
        },
        {
          code: "undocumented_symbol",
          target: "src/core/foo.ts#foo",
          class: "internal_helper",
        },
      ],
    }),
  );

  expect(result.ok).toBe(true);
});

test("compareAuditBaseline fails when the live audit set diverges", () => {
  const result = compareAuditBaseline(
    [{ code: "undocumented_symbol", target: "src/core/new.ts#added" }],
    parseBaseline({
      version: 1,
      entries: [
        {
          code: "undocumented_symbol",
          target: "src/core/old.ts#kept",
          class: "sibling_export",
        },
      ],
    }),
  );

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a mismatch");
  }
  expect(result.message).toContain("src/core/new.ts#added");
  expect(result.message).toContain("src/core/old.ts#kept");
});

test("the repository audit set matches the committed baseline", async () => {
  const result = compareAuditBaseline(
    check({
      projectRoot: ROOT,
      audit: true,
    }).diagnostics,
    parseBaseline(await Bun.file(join(ROOT, "test-fixtures/self-audit/baseline.json")).json()),
  );

  expect(result.ok).toBe(true);
});
