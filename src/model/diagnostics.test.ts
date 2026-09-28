import { expect, test } from "bun:test";

import { summarizeDiagnostics, sortDiagnostics } from "./diagnostics";
import type { DocBridgeDiagnostic } from "./types";

test("sortDiagnostics orders diagnostics deterministically", () => {
  const diagnostics: DocBridgeDiagnostic[] = [
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
      target: "docbridge.config.json",
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
    "docbridge.config.json",
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
