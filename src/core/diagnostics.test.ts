import { expect, test } from "bun:test";

import {
  formatDiagnostic,
  formatSummary,
  summarizeDiagnostics,
  sortDiagnostics,
} from "./diagnostics";
import type { DiagnosticCode, SpecLinkDiagnostic } from "./types";

test("DiagnosticCode matches the v0.1 diagnostics spec", () => {
  const codes = [
    "config_file_invalid",
    "config_unknown_key",
    "config_invalid_value",
    "invalid_link_target",
    "doc_file_not_found",
    "doc_anchor_not_found",
    "code_file_not_found",
    "code_backlink_not_found",
    "doc_backlink_not_found",
    "duplicate_doc_anchor",
    "duplicate_code_symbol",
    "typescript_parse_error",
    "file_read_error",
    "duplicate_link",
    "dangling_code_annotation",
    "unsupported_declaration",
    "undocumented_symbol",
  ] satisfies DiagnosticCode[];

  expect(codes).toHaveLength(17);
});

test("sortDiagnostics orders diagnostics deterministically", () => {
  const diagnostics: SpecLinkDiagnostic[] = [
    {
      severity: "error",
      code: "doc_anchor_not_found",
      target: "docs/specs/missing.md#z",
      message: "Documentation anchor not found.",
      location: {
        filePath: "src/b.ts",
        line: 1,
        column: 1,
      },
    },
    {
      severity: "warning",
      code: "duplicate_link",
      target: "docs/specs/cli.md#check-command",
      message: "Duplicate link annotation.",
      location: {
        filePath: "src/a.ts",
        line: 3,
        column: 1,
      },
    },
    {
      severity: "error",
      code: "config_file_invalid",
      target: "speclink.config.json",
      message: "Failed to parse config file.",
    },
    {
      severity: "error",
      code: "doc_file_not_found",
      target: "docs/specs/missing.md#z",
      message: "Documentation file not found.",
      location: {
        filePath: "src/a.ts",
        line: 3,
        column: 1,
      },
    },
    {
      severity: "error",
      code: "doc_file_not_found",
      target: "docs/specs/missing.md#a",
      message: "Documentation file not found.",
      location: {
        filePath: "src/a.ts",
        line: 3,
        column: 1,
      },
    },
  ];

  const sorted = sortDiagnostics(diagnostics);

  expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
    "config_file_invalid",
    "doc_file_not_found",
    "doc_file_not_found",
    "duplicate_link",
    "doc_anchor_not_found",
  ]);
  expect(sorted.map((diagnostic) => diagnostic.target)).toEqual([
    "speclink.config.json",
    "docs/specs/missing.md#a",
    "docs/specs/missing.md#z",
    "docs/specs/cli.md#check-command",
    "docs/specs/missing.md#z",
  ]);
  expect(sorted).not.toBe(diagnostics);
});

test("summarizeDiagnostics counts errors and warnings", () => {
  expect(
    summarizeDiagnostics([
      {
        severity: "error",
        code: "doc_file_not_found",
        target: "docs/specs/missing.md#check-command",
        message: "Documentation file not found.",
      },
      {
        severity: "warning",
        code: "duplicate_link",
        target: "docs/specs/cli.md#check-command",
        message: "Duplicate link annotation.",
      },
      {
        severity: "warning",
        code: "undocumented_symbol",
        target: "src/cli/index.ts#main",
        message: "Code symbol has no documentation link.",
      },
    ]),
  ).toEqual({
    errors: 1,
    warnings: 2,
  });
});

test("formatDiagnostic formats diagnostics with and without locations", () => {
  expect(
    formatDiagnostic({
      severity: "error",
      code: "doc_anchor_not_found",
      target: "docs/specs/missing.md#check-command",
      message: "Documentation anchor not found.",
      location: {
        filePath: "docs/specs/cli.md",
        line: 12,
        column: 1,
      },
    }),
  ).toBe(
    "docs/specs/cli.md:12:1 error doc_anchor_not_found docs/specs/missing.md#check-command - Documentation anchor not found.",
  );

  expect(
    formatDiagnostic({
      severity: "error",
      code: "config_file_invalid",
      target: "speclink.config.json",
      message: "Failed to parse config file.",
    }),
  ).toBe(
    "speclink.config.json error config_file_invalid - Failed to parse config file.",
  );
});

test("formatSummary formats singular and plural counts", () => {
  expect(formatSummary({ errors: 1, warnings: 1 })).toBe(
    "Summary: 1 error, 1 warning",
  );
  expect(formatSummary({ errors: 2, warnings: 0 })).toBe(
    "Summary: 2 errors, 0 warnings",
  );
});
