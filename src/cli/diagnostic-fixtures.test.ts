import { expect, test } from "bun:test";
import { join } from "node:path";

import type { DiagnosticCode, SpecLinkDiagnostic } from "../core/types";
import { run } from "./index";

/**
 * E2E regression tests for the diagnostic fixture projects under
 * fixtures/diagnostics/. Each fixture is a minimal project that fires exactly
 * one diagnostic code; the assertions are exhaustive (code + file + line, no
 * extra diagnostics) so CI guarantees each fixture stays minimal. Messages are
 * deliberately not asserted.
 *
 * file_read_error has no fixture: I/O failures are not deterministically
 * reproducible from checked-in files. It is covered by unit tests instead.
 */

const FIXTURES_ROOT = join(import.meta.dir, "..", "..", "fixtures", "diagnostics");

type ObservedDiagnostic = {
  code: DiagnosticCode;
  filePath: string | undefined;
  line: number | undefined;
};

function checkFixture(
  code: DiagnosticCode,
  options: { audit?: boolean } = {},
): { exitCode: number; diagnostics: ObservedDiagnostic[] } {
  let out = "";
  let err = "";
  const args = ["check", "--root", join(FIXTURES_ROOT, code), "--json"];
  if (options.audit === true) {
    args.push("--audit");
  }
  const exitCode = run(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  expect(err).toBe("");
  const result = JSON.parse(out) as { diagnostics: SpecLinkDiagnostic[] };
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    filePath: diagnostic.location?.filePath,
    line: diagnostic.location?.line,
  }));
  return { exitCode, diagnostics };
}

// --- config diagnostics (no location; the whole check short-circuits) --------

test("fixture config_file_invalid fires exactly config_file_invalid", () => {
  const { exitCode, diagnostics } = checkFixture("config_file_invalid");

  expect(diagnostics).toEqual([
    { code: "config_file_invalid", filePath: undefined, line: undefined },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture config_unknown_key fires exactly config_unknown_key", () => {
  const { exitCode, diagnostics } = checkFixture("config_unknown_key");

  expect(diagnostics).toEqual([
    { code: "config_unknown_key", filePath: undefined, line: undefined },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture config_invalid_value fires exactly config_invalid_value", () => {
  const { exitCode, diagnostics } = checkFixture("config_invalid_value");

  expect(diagnostics).toEqual([
    { code: "config_invalid_value", filePath: undefined, line: undefined },
  ]);
  expect(exitCode).toBe(1);
});

// --- link target and resolution errors ----------------------------------------

test("fixture invalid_link_target fires exactly invalid_link_target", () => {
  const { exitCode, diagnostics } = checkFixture("invalid_link_target");

  expect(diagnostics).toEqual([
    { code: "invalid_link_target", filePath: "src/example.ts", line: 4 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture doc_file_not_found fires exactly doc_file_not_found", () => {
  const { exitCode, diagnostics } = checkFixture("doc_file_not_found");

  expect(diagnostics).toEqual([
    { code: "doc_file_not_found", filePath: "src/example.ts", line: 4 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture doc_anchor_not_found fires exactly doc_anchor_not_found", () => {
  const { exitCode, diagnostics } = checkFixture("doc_anchor_not_found");

  expect(diagnostics).toEqual([
    { code: "doc_anchor_not_found", filePath: "src/example.ts", line: 4 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture code_file_not_found fires exactly code_file_not_found", () => {
  const { exitCode, diagnostics } = checkFixture("code_file_not_found");

  expect(diagnostics).toEqual([
    { code: "code_file_not_found", filePath: "docs/spec.md", line: 1 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture code_backlink_not_found fires exactly code_backlink_not_found", () => {
  const { exitCode, diagnostics } = checkFixture("code_backlink_not_found");

  expect(diagnostics).toEqual([
    { code: "code_backlink_not_found", filePath: "docs/spec.md", line: 1 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture doc_backlink_not_found fires exactly doc_backlink_not_found", () => {
  const { exitCode, diagnostics } = checkFixture("doc_backlink_not_found");

  expect(diagnostics).toEqual([
    { code: "doc_backlink_not_found", filePath: "src/example.ts", line: 4 },
  ]);
  expect(exitCode).toBe(1);
});

// --- scanner errors -----------------------------------------------------------

test("fixture duplicate_doc_anchor fires exactly duplicate_doc_anchor", () => {
  const { exitCode, diagnostics } = checkFixture("duplicate_doc_anchor");

  expect(diagnostics).toEqual([
    { code: "duplicate_doc_anchor", filePath: "docs/spec.md", line: 3 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture duplicate_code_symbol fires exactly duplicate_code_symbol", () => {
  const { exitCode, diagnostics } = checkFixture("duplicate_code_symbol");

  expect(diagnostics).toEqual([
    { code: "duplicate_code_symbol", filePath: "src/example.ts", line: 11 },
  ]);
  expect(exitCode).toBe(1);
});

test("fixture typescript_parse_error fires exactly typescript_parse_error", () => {
  const { exitCode, diagnostics } = checkFixture("typescript_parse_error");

  expect(diagnostics).toEqual([
    { code: "typescript_parse_error", filePath: "src/example.ts", line: 1 },
  ]);
  expect(exitCode).toBe(1);
});

// --- warnings (exit code stays 0) ----------------------------------------------

test("fixture duplicate_link fires exactly duplicate_link", () => {
  const { exitCode, diagnostics } = checkFixture("duplicate_link");

  expect(diagnostics).toEqual([
    { code: "duplicate_link", filePath: "src/example.ts", line: 5 },
  ]);
  expect(exitCode).toBe(0);
});

test("fixture dangling_code_annotation fires exactly dangling_code_annotation", () => {
  const { exitCode, diagnostics } = checkFixture("dangling_code_annotation");

  expect(diagnostics).toEqual([
    { code: "dangling_code_annotation", filePath: "docs/spec.md", line: 1 },
  ]);
  expect(exitCode).toBe(0);
});

test("fixture unsupported_declaration fires exactly unsupported_declaration", () => {
  const { exitCode, diagnostics } = checkFixture("unsupported_declaration");

  expect(diagnostics).toEqual([
    { code: "unsupported_declaration", filePath: "src/example.ts", line: 4 },
  ]);
  expect(exitCode).toBe(0);
});

test("fixture undocumented_symbol fires exactly undocumented_symbol under --audit", () => {
  const { exitCode, diagnostics } = checkFixture("undocumented_symbol", { audit: true });

  expect(diagnostics).toEqual([
    { code: "undocumented_symbol", filePath: "src/example.ts", line: 1 },
  ]);
  expect(exitCode).toBe(0);
});

test("fixture undocumented_symbol is clean without --audit", () => {
  const { exitCode, diagnostics } = checkFixture("undocumented_symbol");

  expect(diagnostics).toEqual([]);
  expect(exitCode).toBe(0);
});
