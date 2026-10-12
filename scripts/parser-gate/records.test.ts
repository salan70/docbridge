import { describe, expect, test } from "bun:test";

import {
  type GateRecord,
  type RecordMeta,
  type ScannedFile,
  alignResponse,
  chunk,
  formatTable,
  parseConstructs,
  parseFileList,
  requestFilePath,
  buildRecord,
  checkInjection,
  multisetDifference,
  statusOf,
  summarize,
  withConstruct,
} from "./records";
import { INJECTED_TARGET, type ReportedSymbol } from "./variants";

function symbol(canonicalId: string, line = 1, column = 1): ReportedSymbol {
  return { canonicalId, endpoint: `E:${canonicalId}`, location: { line, column } };
}

function scanned(overrides: Partial<ScannedFile> = {}): ScannedFile {
  return { symbols: [], undocumentedSymbols: [], links: [], diagnostics: [], ...overrides };
}

const PARSE_ERROR = { code: "code_parse_error", message: "x", location: { line: 10, column: 3 } };

const META: RecordMeta = {
  language: "swift",
  set: "development",
  repository: "o/n",
  path: "Sources/A.swift",
  contentSha256: "abc",
  variant: "unmodified",
  configuration: "default",
};

describe("statusOf", () => {
  test("distinguishes accept, reject and failed", () => {
    expect(statusOf(scanned())).toBe("accept");
    expect(statusOf(scanned({ diagnostics: [{ code: "other" }] }))).toBe("accept");
    expect(statusOf(scanned({ diagnostics: [PARSE_ERROR] }))).toBe("reject");
    expect(statusOf("failed")).toBe("failed");
  });
});

describe("multisetDifference", () => {
  test("counts missing and extra with multiplicity", () => {
    expect(multisetDifference(["a", "a", "b"], ["a", "c", "c"])).toEqual({
      shipped: 3,
      candidate: 3,
      missing: 2,
      extra: 2,
    });
  });

  test("is order independent and zero for equal multisets", () => {
    expect(multisetDifference(["a", "b", "a"], ["a", "a", "b"])).toEqual({
      shipped: 3,
      candidate: 3,
      missing: 0,
      extra: 0,
    });
  });

  test("distinguishes a duplicate from a single occurrence", () => {
    expect(multisetDifference(["a", "a"], ["a"])).toEqual({
      shipped: 2,
      candidate: 1,
      missing: 1,
      extra: 0,
    });
  });
});

describe("buildRecord", () => {
  test("marks identical accepted results", () => {
    const result = scanned({ symbols: [symbol("A")] });
    const record = buildRecord(META, result, structuredClone(result));
    expect(record).toMatchObject({
      shipped: "accept",
      candidate: "accept",
      identical: true,
      symbols: { shipped: 1, candidate: 1, missing: 0, extra: 0 },
      links: { shipped: 0, candidate: 0, missing: 0, extra: 0 },
    });
    expect(record.firstDifference).toBeUndefined();
    expect(record.rejection).toBeUndefined();
    expect(record.injected).toBeUndefined();
  });

  test("reports the first difference and the multiset counts", () => {
    const shipped = scanned({
      symbols: [symbol("A")],
      undocumentedSymbols: [symbol("B")],
      links: [{ source: "E:A", target: "d.md", location: { line: 1, column: 1 } }],
    });
    const candidate = scanned({ symbols: [symbol("A")], undocumentedSymbols: [symbol("C")] });
    const record = buildRecord(META, shipped, candidate);
    expect(record.identical).toBe(false);
    expect(record.firstDifference).toBe("/links/0");
    expect(record.symbols).toEqual({ shipped: 2, candidate: 2, missing: 1, extra: 1 });
    expect(record.links).toEqual({ shipped: 1, candidate: 0, missing: 1, extra: 0 });
  });

  test("counts a symbol moved between the two lists as equal", () => {
    const shipped = scanned({ symbols: [symbol("A")] });
    const candidate = scanned({ undocumentedSymbols: [symbol("A")] });
    const record = buildRecord(META, shipped, candidate);
    expect(record.symbols).toEqual({ shipped: 1, candidate: 1, missing: 0, extra: 0 });
    expect(record.identical).toBe(false);
  });

  test("compares links by source and target only", () => {
    const shipped = scanned({
      links: [{ source: "s", target: "t", location: { line: 1, column: 1 } }],
    });
    const candidate = scanned({
      links: [{ source: "s", target: "t", location: { line: 9, column: 9 } }],
    });
    const record = buildRecord(META, shipped, candidate);
    expect(record.links).toEqual({ shipped: 1, candidate: 1, missing: 0, extra: 0 });
    expect(record.identical).toBe(false);
    expect(record.firstDifference).toBe("/links/0/location/column");
  });

  test("treats two rejections as identical when only the message and position differ", () => {
    const candidatePosition = { ...PARSE_ERROR, message: "y", location: { line: 2, column: 2 } };
    const record = buildRecord(
      META,
      scanned({ diagnostics: [PARSE_ERROR] }),
      scanned({ diagnostics: [candidatePosition] }),
    );
    expect(record).toMatchObject({ shipped: "reject", candidate: "reject", identical: true });
    expect(record.rejection).toEqual({
      shipped: { line: 10, column: 3 },
      candidate: { line: 2, column: 2 },
    });
  });

  test("records the rejection location of the rejecting side only", () => {
    const record = buildRecord(META, scanned(), scanned({ diagnostics: [PARSE_ERROR] }));
    expect(record).toMatchObject({ shipped: "accept", candidate: "reject", identical: false });
    expect(record.rejection).toEqual({ candidate: { line: 10, column: 3 } });
  });

  test("covers reject on the shipped side with accept on the candidate side", () => {
    const record = buildRecord(META, scanned({ diagnostics: [PARSE_ERROR] }), scanned());
    expect(record).toMatchObject({ shipped: "reject", candidate: "accept", identical: false });
    expect(record.rejection).toEqual({ shipped: { line: 10, column: 3 } });
  });

  test("is never identical when a side failed, even when both failed", () => {
    for (const [shipped, candidate] of [
      ["failed", scanned()],
      [scanned(), "failed"],
      ["failed", "failed"],
    ] as const) {
      const record = buildRecord(META, shipped, candidate);
      expect(record.identical).toBe(false);
      expect(record.firstDifference).toBeUndefined();
    }
    expect(buildRecord(META, "failed", scanned()).shipped).toBe("failed");
    expect(buildRecord(META, scanned(), "failed").candidate).toBe("failed");
  });

  test("omits the rejection when a parse error has no location", () => {
    const record = buildRecord(
      META,
      scanned({ diagnostics: [{ code: "code_parse_error" }] }),
      scanned(),
    );
    expect(record.rejection).toBeUndefined();
  });

  test("attaches the injected check", () => {
    const record = buildRecord(META, scanned(), scanned(), {
      symbol: "A.f()",
      shippedOk: true,
      candidateOk: false,
    });
    expect(record.injected).toEqual({ symbol: "A.f()", shippedOk: true, candidateOk: false });
  });

  test("serializes in the documented key order", () => {
    const record = buildRecord(META, scanned(), scanned());
    expect(Object.keys(record)).toEqual([
      "language",
      "set",
      "repository",
      "path",
      "contentSha256",
      "variant",
      "configuration",
      "shipped",
      "candidate",
      "identical",
      "symbols",
      "links",
    ]);
  });
});

describe("checkInjection", () => {
  const expected = {
    source: "E:A.f()",
    target: INJECTED_TARGET,
    location: { line: 3, column: 14 },
  };
  const base = scanned({
    links: [{ source: "E:A.g()", target: "d.md#g", location: { line: 7, column: 10 } }],
  });

  test("accepts exactly one added link at the expected position", () => {
    const injected = scanned({
      links: [
        { source: "E:A.g()", target: "d.md#g", location: { line: 8, column: 10 } },
        { source: expected.source, target: expected.target, location: expected.location },
      ],
    });
    expect(checkInjection(base, injected, expected)).toBe(true);
  });

  test("rejects a missing link, an extra link, and a wrong position or source", () => {
    const added = { source: expected.source, target: expected.target, location: expected.location };
    expect(checkInjection(base, base, expected)).toBe(false);
    expect(
      checkInjection(
        base,
        scanned({ links: [...base.links, added, { ...added, target: "other.md" }] }),
        expected,
      ),
    ).toBe(false);
    expect(
      checkInjection(
        base,
        scanned({ links: [...base.links, { ...added, location: { line: 3, column: 15 } }] }),
        expected,
      ),
    ).toBe(false);
    expect(
      checkInjection(
        base,
        scanned({ links: [...base.links, { ...added, source: "E:other" }] }),
        expected,
      ),
    ).toBe(false);
  });

  test("rejects a lost existing link even when the added one is right", () => {
    const injected = scanned({
      links: [{ source: expected.source, target: expected.target, location: expected.location }],
    });
    expect(checkInjection(base, injected, expected)).toBe(false);
  });

  test("is false when either result failed or was rejected", () => {
    expect(checkInjection("failed", base, expected)).toBe(false);
    expect(checkInjection(base, "failed", expected)).toBe(false);
    expect(checkInjection(base, scanned({ diagnostics: [PARSE_ERROR] }), expected)).toBe(false);
  });
});

function row(overrides: Partial<GateRecord>): GateRecord {
  return {
    ...buildRecord(META, scanned(), scanned()),
    ...overrides,
  };
}

describe("summarize", () => {
  test("excludes shipped failures from the rejection-rate denominator", () => {
    const records = [
      row({ path: "a", shipped: "accept", candidate: "accept" }),
      row({ path: "b", shipped: "accept", candidate: "reject", identical: false }),
      row({ path: "c", shipped: "accept", candidate: "failed", identical: false }),
      row({ path: "d", shipped: "failed", candidate: "accept", identical: false }),
      row({ path: "e", shipped: "reject", candidate: "reject" }),
    ];
    const { overall } = summarize(records);
    expect(overall).toMatchObject({
      files: 5,
      shippedFailed: 1,
      shippedAccepted: 3,
      candidateRejected: 1,
      candidateFailed: 1,
    });
    expect(overall.rejectionRate).toBeCloseTo(1 / 3);
  });

  test("keeps a failed candidate run out of the rejections and in the rule", () => {
    const { overall, rule } = summarize([
      row({ path: "a", shipped: "accept", candidate: "failed", identical: false }),
      row({ path: "b", shipped: "failed", candidate: "accept", identical: false }),
    ]);
    expect(overall.candidateRejected).toBe(0);
    expect(rule).toMatchObject({ candidateFailed: 1, shippedFailed: 1 });
  });

  test("uses only default-configuration unmodified rows for file counts", () => {
    const records = [
      row({ path: "a" }),
      row({ path: "a", configuration: "internal", candidate: "reject" }),
      row({ path: "a", variant: "injected", candidate: "reject" }),
    ];
    const { overall } = summarize(records);
    expect(overall).toMatchObject({ files: 1, shippedAccepted: 1, candidateRejected: 0 });
    expect(overall.rejectionRate).toBe(0);
  });

  test("has a null rate when the shipped worker accepted nothing", () => {
    const { overall, rule } = summarize([row({ shipped: "reject", candidate: "accept" })]);
    expect(overall.rejectionRate).toBeNull();
    expect(overall.candidateOnlyAccepted).toBe(1);
    expect(rule.maxRepositoryRejectionRate).toBeNull();
    expect(rule.maxRepository).toBeNull();
  });

  test("counts rows accepted by both, per variant, over all variants and configurations", () => {
    const records = [
      row({ variant: "unmodified" }),
      row({ variant: "unmodified", configuration: "internal", identical: false }),
      row({ variant: "injected", identical: false }),
      row({ variant: "malformed:truncate", shipped: "reject", candidate: "reject" }),
      row({ variant: "malformed:truncate", candidate: "failed", identical: false }),
    ];
    const { overall } = summarize(records);
    expect(overall.acceptedByBoth).toBe(3);
    expect(overall.notIdentical).toBe(2);
    expect(overall.byVariant).toEqual({
      unmodified: { acceptedByBoth: 2, notIdentical: 1 },
      injected: { acceptedByBoth: 1, notIdentical: 1 },
    });
  });

  test("counts failed injected checks", () => {
    const records = [
      row({
        variant: "injected",
        injected: { symbol: "a", shippedOk: true, candidateOk: true },
      }),
      row({
        variant: "injected",
        injected: { symbol: "b", shippedOk: true, candidateOk: false },
      }),
      row({
        variant: "injected",
        injected: { symbol: "c", shippedOk: false, candidateOk: false },
      }),
    ];
    const { overall, rule } = summarize(records);
    expect(overall.injectedChecks).toEqual({ rows: 3, shippedNotOk: 1, candidateNotOk: 2 });
    expect(rule.injectedFailures).toEqual({ shipped: 1, candidate: 2 });
  });

  test("tallies malformed acceptance as a 2x2 table plus failures", () => {
    const records = [
      row({ variant: "malformed:delete-brace", shipped: "accept", candidate: "accept" }),
      row({ variant: "malformed:delete-brace", shipped: "accept", candidate: "reject" }),
      row({ variant: "malformed:insert-paren", shipped: "reject", candidate: "accept" }),
      row({ variant: "malformed:insert-paren", shipped: "reject", candidate: "reject" }),
      row({ variant: "malformed:truncate", shipped: "reject", candidate: "reject" }),
      row({ variant: "malformed:truncate", shipped: "failed", candidate: "reject" }),
      row({ variant: "unmodified", shipped: "accept", candidate: "reject" }),
    ];
    expect(summarize(records).overall.malformed).toEqual({
      acceptAccept: 1,
      acceptReject: 1,
      rejectAccept: 1,
      rejectReject: 2,
      failed: 1,
    });
  });

  test("groups by repository and names the worst repository in the rule", () => {
    const records = [
      row({ repository: "o/a", path: "1" }),
      row({ repository: "o/a", path: "2", candidate: "reject", identical: false }),
      row({ repository: "o/b", path: "1", candidate: "reject", identical: false }),
      row({ repository: "o/b", path: "2", candidate: "reject", identical: false }),
      row({ repository: "o/b", path: "3" }),
      row({ repository: "o/c", path: "1", identical: false }),
    ];
    const summary = summarize(records);
    expect(Object.keys(summary.repositories)).toEqual(["o/a", "o/b", "o/c"]);
    expect(summary.repositories["o/a"]?.rejectionRate).toBe(0.5);
    expect(summary.rule).toMatchObject({
      rejectionRate: 3 / 6,
      maxRepositoryRejectionRate: 2 / 3,
      maxRepository: "o/b",
      notIdentical: 1,
    });
  });

  test("returns zeroed statistics for no records", () => {
    const { overall, repositories } = summarize([]);
    expect(overall.files).toBe(0);
    expect(overall.rejectionRate).toBeNull();
    expect(repositories).toEqual({});
  });
});

describe("chunk", () => {
  test("splits into runs of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 40)).toEqual([]);
  });
});

describe("requestFilePath", () => {
  test("replaces the slash of the repository name", () => {
    expect(requestFilePath("owner/name", "Sources/A.swift")).toBe("owner__name/Sources/A.swift");
  });
});

describe("parseFileList", () => {
  test("reads one entry per non-empty line", () => {
    const text = `${JSON.stringify({ repository: "o/n", path: "a.swift", file: "/x/a.swift" })}\n\n`;
    expect(parseFileList(text)).toEqual([
      { repository: "o/n", path: "a.swift", file: "/x/a.swift" },
    ]);
  });

  test("rejects a malformed entry", () => {
    expect(() => parseFileList('{"repository":"o/n"}\n')).toThrow();
  });
});

describe("alignResponse", () => {
  const file = (filePath: string) => ({ filePath, ...scanned() });

  test("orders the response files like the request", () => {
    const aligned = alignResponse(["a", "b"], [file("b"), file("a")]);
    expect(aligned?.map((entry) => entry.filePath)).toEqual(["a", "b"]);
  });

  test("is undefined when a file is missing or duplicated", () => {
    expect(alignResponse(["a", "b"], [file("a")])).toBeUndefined();
    expect(alignResponse(["a"], [file("a"), file("a")])).toBeUndefined();
  });
});

describe("formatTable", () => {
  test("has one row per repository and a total", () => {
    const summary = summarize([row({ repository: "o/a" }), row({ repository: "o/b" })]);
    const lines = formatTable(summary).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("repository");
    expect(lines[1]).toContain("o/a");
    expect(lines[3]).toContain("TOTAL");
  });
});

describe("parseConstructs", () => {
  test("maps each path to its construct, null when accepted or absent", () => {
    const stdout = [
      '{"path":"/a.swift","accepted":false,"error":"x","construct":"class_body","micros":1}',
      '{"path":"/b.swift","accepted":true,"error":null,"construct":null,"micros":1}',
      '{"path":"/c.swift","accepted":false,"error":"x","micros":1}',
      "",
    ].join("\n");
    expect(parseConstructs(stdout)).toEqual(
      new Map([
        ["/a.swift", "class_body"],
        ["/b.swift", null],
        ["/c.swift", null],
      ]),
    );
  });

  test("throws on a malformed line", () => {
    expect(() => parseConstructs('{"accepted":false}\n')).toThrow();
  });
});

describe("withConstruct", () => {
  test("adds the construct to an unmodified row the candidate rejected", () => {
    const rejected = row({ shipped: "accept", candidate: "reject" });
    expect(withConstruct(rejected, "class_body")).toEqual({ ...rejected, construct: "class_body" });
    expect(withConstruct(rejected, undefined)).toEqual({ ...rejected, construct: null });
  });

  test("leaves other rows unchanged", () => {
    const accepted = row({ shipped: "accept", candidate: "accept" });
    const injected = row({ variant: "injected", candidate: "reject" });
    expect(withConstruct(accepted, "class_body")).toBe(accepted);
    expect(withConstruct(injected, "class_body")).toBe(injected);
  });
});

describe("summarize constructs", () => {
  test("counts default-configuration rejected files by construct", () => {
    const { constructs } = summarize([
      row({ path: "a", shipped: "accept", candidate: "reject", construct: "class_body" }),
      row({ path: "b", shipped: "accept", candidate: "reject", construct: "class_body" }),
      row({ path: "c", shipped: "accept", candidate: "reject", construct: "enum_body" }),
      row({ path: "d", shipped: "accept", candidate: "reject", construct: null }),
      row({
        path: "e",
        shipped: "accept",
        candidate: "reject",
        construct: "enum_body",
        configuration: "internal",
      }),
      row({ path: "f", shipped: "reject", candidate: "reject", construct: "enum_body" }),
    ]);
    expect(constructs).toEqual({ class_body: 2, enum_body: 1, unknown: 1 });
    expect(Object.keys(constructs)).toEqual(["class_body", "enum_body", "unknown"]);
  });
});
