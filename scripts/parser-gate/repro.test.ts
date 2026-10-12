import { expect, test } from "bun:test";

import type { ScannedFile } from "./records";
import { caseMismatch, causesProblems, differingFiles, parseArgs, parseCase } from "./repro";

const accepted: ScannedFile = { symbols: [], undocumentedSymbols: [], links: [], diagnostics: [] };

const rejected: ScannedFile = {
  ...accepted,
  diagnostics: [{ code: "code_parse_error", location: { line: 1, column: 1 } }],
};

const grammarCase = {
  kind: "grammar",
  construct: "The empty tuple as a value.",
  shipped: "accept",
  candidate: "reject",
} as const;

test("arguments select languages and a cause set", () => {
  expect(parseArgs([])).toEqual({ languages: ["swift", "dart"], causes: undefined });
  expect(parseArgs(["swift", "--causes", "holdout"])).toEqual({
    languages: ["swift"],
    causes: "holdout",
  });
});

test("arguments reject an unknown cause set and an unknown option", () => {
  expect(() => parseArgs(["--causes", "other"])).toThrow("--causes needs");
  expect(() => parseArgs(["--causes"])).toThrow("--causes needs");
  expect(() => parseArgs(["rust"])).toThrow("unexpected argument");
});

test("a case needs a known kind, a construct and both verdicts", () => {
  expect(parseCase(grammarCase)).toEqual(grammarCase);
  expect(() => parseCase({ ...grammarCase, kind: "other" })).toThrow("kind must be");
  expect(() => parseCase({ ...grammarCase, construct: "" })).toThrow("construct");
  expect(() => parseCase({ ...grammarCase, candidate: "maybe" })).toThrow("accept");
  expect(() => parseCase({ ...grammarCase, extra: 1 })).toThrow("unknown keys: extra");
  expect(() => parseCase([])).toThrow("must be an object");
});

test("identical is required exactly when both sides accept", () => {
  const both = { ...grammarCase, candidate: "accept" };
  expect(() => parseCase(both)).toThrow("identical is required");
  expect(parseCase({ ...both, identical: true }).identical).toBe(true);
  expect(() => parseCase({ ...grammarCase, identical: false })).toThrow("identical applies only");
});

test("a case matches when the verdicts match", () => {
  expect(caseMismatch(parseCase(grammarCase), accepted, rejected)).toBeUndefined();
});

test("a case reports the side whose verdict differs", () => {
  expect(caseMismatch(parseCase(grammarCase), rejected, rejected)).toBe(
    "shipped reject, expected accept",
  );
  expect(caseMismatch(parseCase(grammarCase), accepted, accepted)).toBe(
    "candidate accept, expected reject",
  );
});

test("a failed worker is reported by side", () => {
  expect(caseMismatch(parseCase(grammarCase), undefined, rejected)).toBe("shipped worker failed");
  expect(caseMismatch(parseCase(grammarCase), accepted, undefined)).toBe("candidate worker failed");
});

test("identical compares the scans when both accept", () => {
  const spec = parseCase({ ...grammarCase, candidate: "accept", identical: true });
  const other: ScannedFile = {
    ...accepted,
    links: [{ source: "a", target: "b", location: { line: 1, column: 1 } }],
  };
  expect(caseMismatch(spec, accepted, accepted)).toBeUndefined();
  expect(caseMismatch(spec, accepted, other)).toBe("identical false, expected true");
});

const row = {
  repository: "owner/repo",
  path: "Sources/A.swift",
  variant: "unmodified",
  configuration: "default",
  shipped: "accept",
  candidate: "reject",
  identical: false,
};

test("differing files are the unmodified files the shipped worker accepts and the candidate does not match", () => {
  const rows = [
    row,
    { ...row, path: "Sources/B.swift", candidate: "accept", identical: true },
    { ...row, path: "Sources/C.swift", shipped: "reject" },
    { ...row, path: "Sources/D.swift", variant: "injected" },
    { ...row, path: "Sources/E.swift", configuration: "internal", candidate: "accept" },
    { ...row, path: "Sources/F.swift", candidate: "failed" },
  ];
  expect([...differingFiles(rows)].toSorted()).toEqual([
    "owner/repo/Sources/A.swift",
    "owner/repo/Sources/E.swift",
    "owner/repo/Sources/F.swift",
  ]);
});

test("causes are consistent when each has a case and the files match", () => {
  const causes = { "owner/repo/Sources/A.swift": ["empty-tuple"] };
  expect(
    causesProblems(causes, new Set(["empty-tuple"]), new Set(["owner/repo/Sources/A.swift"])),
  ).toEqual([]);
});

test("causes without a case and files without causes are problems", () => {
  const causes = {
    "owner/repo/A.swift": ["missing"],
    "owner/repo/B.swift": [],
    "owner/repo/C.swift": ["known"],
  };
  const differing = new Set(["owner/repo/A.swift", "owner/repo/B.swift", "owner/repo/D.swift"]);
  expect(causesProblems(causes, new Set(["known"]), differing)).toEqual([
    "owner/repo/A.swift: cause missing has no case",
    "owner/repo/B.swift: no cause",
    "owner/repo/D.swift: differs but has no causes",
  ]);
});

test("without measured records only the cases are checked", () => {
  expect(
    causesProblems({ "owner/repo/A.swift": ["known"] }, new Set(["known"]), undefined),
  ).toEqual([]);
});
