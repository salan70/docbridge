import { expect, test } from "bun:test";

import { formatDiagnostic, formatSummary } from "./diagnostics";

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
      target: "docbridge.config.json",
      message: "Failed to parse config file.",
    }),
  ).toBe("docbridge.config.json error config_file_invalid - Failed to parse config file.");
});

test("formatSummary formats singular and plural counts", () => {
  expect(formatSummary({ errors: 1, warnings: 1 })).toBe("Summary: 1 error, 1 warning");
  expect(formatSummary({ errors: 2, warnings: 0 })).toBe("Summary: 2 errors, 0 warnings");
});
