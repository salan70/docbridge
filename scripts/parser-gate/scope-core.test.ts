import { describe, expect, test } from "bun:test";

import {
  type FileScope,
  type ScopeScan,
  aggregate,
  formatScopeTable,
  overlapOf,
  reportOf,
  scopeFile,
  selectRejected,
} from "./scope-core";

const FILE = "o__n/Sources/A.swift";

function symbol(canonicalId: string, extra: Record<string, unknown> = {}) {
  return { kind: "code", canonicalId, location: { line: 1, column: 1 }, ...extra };
}

function scan(overrides: Partial<ScopeScan> = {}): ScopeScan {
  return { symbols: [], undocumentedSymbols: [], links: [], diagnostics: [], ...overrides };
}

const WHOLE = { code: "code_parse_error", target: FILE };

function dropped(id: string) {
  return { code: "code_parse_error", target: `${FILE}#${id}` };
}

function fileScope(overrides: Partial<FileScope> = {}): FileScope {
  const zero = { shipped: 0, candidate: 0, both: 0, identical: 0 };
  return {
    repository: "o/n",
    path: "Sources/A.swift",
    configuration: "default",
    symbols: zero,
    links: zero,
    droppedDeclarations: 0,
    wholeFile: false,
    ...overrides,
  };
}

describe("overlapOf", () => {
  test("matches by key with multiplicity and counts identical content", () => {
    const shipped = [
      { k: "a", v: 1 },
      { k: "a", v: 2 },
      { k: "b", v: 1 },
      { k: "c", v: 1 },
    ];
    const candidate = [
      { k: "a", v: 1 },
      { k: "a", v: 3 },
      { k: "b", v: 1 },
      { k: "d", v: 1 },
    ];
    expect(overlapOf(shipped, candidate, (item) => item.k)).toEqual({
      shipped: 4,
      candidate: 4,
      both: 3,
      identical: 2,
    });
  });

  test("is zero for empty sides", () => {
    expect(overlapOf([], [], () => "")).toEqual({
      shipped: 0,
      candidate: 0,
      both: 0,
      identical: 0,
    });
  });
});

describe("scopeFile", () => {
  test("merges documented and undocumented symbols and keys by kind and canonicalId", () => {
    const shipped = scan({
      symbols: [symbol("A")],
      undocumentedSymbols: [symbol("B"), symbol("C")],
      links: [{ source: "A", target: "d.md", location: { line: 1, column: 1 } }],
    });
    const candidate = scan({
      symbols: [symbol("A")],
      undocumentedSymbols: [symbol("B", { location: { line: 9, column: 1 } })],
      links: [{ source: "A", target: "d.md", location: { line: 1, column: 1 } }],
      diagnostics: [dropped("C")],
    });
    const result = scopeFile({
      repository: "o/n",
      path: "Sources/A.swift",
      configuration: "default",
      filePath: FILE,
      shipped,
      candidate,
    });
    expect(result.symbols).toEqual({ shipped: 3, candidate: 2, both: 2, identical: 1 });
    expect(result.links).toEqual({ shipped: 1, candidate: 1, both: 1, identical: 1 });
    expect(result.droppedDeclarations).toBe(1);
    expect(result.wholeFile).toBe(false);
  });

  test("recognizes a whole-file rejection by its target", () => {
    const result = scopeFile({
      repository: "o/n",
      path: "Sources/A.swift",
      configuration: "default",
      filePath: FILE,
      shipped: scan({ symbols: [symbol("A")] }),
      candidate: scan({ diagnostics: [WHOLE] }),
    });
    expect(result.wholeFile).toBe(true);
    expect(result.droppedDeclarations).toBe(0);
    expect(result.symbols.both).toBe(0);
  });
});

describe("selectRejected", () => {
  test("keeps unmodified rows the shipped worker accepts and the candidate does not", () => {
    const rows = [
      { variant: "unmodified", shipped: "accept", candidate: "reject", configuration: "default" },
      { variant: "unmodified", shipped: "accept", candidate: "failed", configuration: "internal" },
      { variant: "unmodified", shipped: "accept", candidate: "accept", configuration: "default" },
      { variant: "unmodified", shipped: "reject", candidate: "reject", configuration: "default" },
      { variant: "injected", shipped: "accept", candidate: "reject", configuration: "default" },
    ];
    expect(selectRejected(rows)).toEqual(rows.slice(0, 2));
  });
});

describe("aggregate", () => {
  test("computes precision, recall, identical ratio and full-recall files", () => {
    const rows = [
      fileScope({
        symbols: { shipped: 4, candidate: 2, both: 2, identical: 1 },
        links: { shipped: 2, candidate: 1, both: 1, identical: 1 },
        wholeFile: false,
      }),
      fileScope({ symbols: { shipped: 2, candidate: 2, both: 2, identical: 2 }, wholeFile: true }),
    ];
    const result = aggregate(rows);
    expect(result.files).toBe(2);
    expect(result.wholeFileRejections).toBe(1);
    expect(result.fullRecallFiles).toBe(1);
    expect(result.symbols).toEqual({
      shipped: 6,
      candidate: 4,
      both: 4,
      identical: 3,
      precision: 1,
      recall: 4 / 6,
      identicalRatio: 3 / 4,
    });
    expect(result.links.recall).toBe(0.5);
  });

  test("gives null where the divisor is zero", () => {
    const result = aggregate([fileScope()]);
    expect(result.symbols.precision).toBeNull();
    expect(result.symbols.recall).toBeNull();
    expect(result.symbols.identicalRatio).toBeNull();
    expect(result.fullRecallFiles).toBe(0);
  });
});

describe("reportOf", () => {
  test("groups by configuration and repository", () => {
    const rows = [
      fileScope({ repository: "a/x", configuration: "default" }),
      fileScope({ repository: "b/y", configuration: "default" }),
      fileScope({ repository: "a/x", configuration: "internal" }),
    ];
    const report = reportOf("swift", "development", rows);
    expect(report.overall.files).toBe(3);
    expect(Object.keys(report.configurations)).toEqual(["default", "internal"]);
    expect(report.configurations["default"]?.overall.files).toBe(2);
    expect(Object.keys(report.configurations["default"]?.repositories ?? {})).toEqual([
      "a/x",
      "b/y",
    ]);
  });

  test("formats a table with a total row", () => {
    const report = reportOf("swift", "development", [fileScope()]);
    const table = formatScopeTable(report);
    expect(table).toContain("TOTAL");
    expect(table).toContain("default");
  });
});
