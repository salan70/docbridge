import { describe, expect, test } from "bun:test";

import {
  OVER_LIMIT_MICROS,
  formatTimingTable,
  isStalled,
  parseMaxRss,
  parseTimingLine,
  stalledPath,
  summarizeTiming,
  timeCommandFlag,
} from "./corpus-timing-core";

describe("parseTimingLine", () => {
  test("reads the path and micros, ignoring other keys", () => {
    const line = '{"path":"/a.swift","accepted":true,"error":null,"micros":1200,"construct":"x"}';
    expect(parseTimingLine(line)).toEqual({ path: "/a.swift", micros: 1200 });
  });

  test("rejects a line without micros", () => {
    expect(() => parseTimingLine('{"path":"/a.swift","unreadable":true}')).toThrow();
    expect(() => parseTimingLine("[]")).toThrow();
  });
});

const sample = (path: string, micros: number): { path: string; micros: number } => ({
  path,
  micros,
});

describe("summarizeTiming", () => {
  test("totals, median, 99th percentile, maximum and slowest path", () => {
    const samples = Array.from({ length: 100 }, (_, index) => sample(`f${index}`, index + 1));
    const stats = summarizeTiming(samples);
    expect(stats).toEqual({
      files: 100,
      totalMicros: 5050,
      medianMicros: 50.5,
      p99Micros: 99,
      maxMicros: 100,
      slowestPath: "f99",
      overLimit: 0,
    });
  });

  test("counts files over the limit and handles one file", () => {
    const stats = summarizeTiming([sample("a", OVER_LIMIT_MICROS + 1), sample("b", 5)]);
    expect(stats.overLimit).toBe(1);
    expect(stats.slowestPath).toBe("a");
    expect(summarizeTiming([sample("only", 7)]).p99Micros).toBe(7);
  });

  test("an empty set has no slowest path", () => {
    expect(summarizeTiming([])).toEqual({
      files: 0,
      totalMicros: 0,
      medianMicros: 0,
      p99Micros: 0,
      maxMicros: 0,
      slowestPath: null,
      overLimit: 0,
    });
  });
});

describe("timeCommandFlag", () => {
  test("picks the flag that reports the resident set size", () => {
    expect(timeCommandFlag("darwin")).toBe("-l");
    expect(timeCommandFlag("linux")).toBe("-v");
    expect(timeCommandFlag("win32")).toBeNull();
  });
});

describe("parseMaxRss", () => {
  test("reads bytes from the macOS report", () => {
    const report =
      "        1.23 real         1.00 user         0.20 sys\n  73924608  maximum resident set size\n      5000  page reclaims\n";
    expect(parseMaxRss(report, "darwin")).toBe(73_924_608);
  });

  test("reads kilobytes from the GNU report", () => {
    const report =
      '\tCommand being timed: "x"\n\tMaximum resident set size (kbytes): 72192\n\tPage size (bytes): 4096\n';
    expect(parseMaxRss(report, "linux")).toBe(72_192 * 1024);
  });

  test("gives null when the report has no such line", () => {
    expect(parseMaxRss("nothing here", "darwin")).toBeNull();
    expect(parseMaxRss("nothing here", "linux")).toBeNull();
  });
});

describe("formatTimingTable", () => {
  test("has a row per language with memory or n/a", () => {
    const stats = summarizeTiming([{ path: "a", micros: 2000 }]);
    const table = formatTimingTable([
      { language: "swift", stats, maxRssBytes: 104_857_600 },
      { language: "dart", stats, maxRssBytes: null },
    ]);
    expect(table).toContain("swift");
    expect(table).toContain("100.0");
    expect(table).toContain("n/a");
  });
});

describe("isStalled", () => {
  test("is true only when the gap since the last line is over the limit", () => {
    expect(isStalled(1_000, 10_999)).toBe(false);
    expect(isStalled(1_000, 11_000)).toBe(false);
    expect(isStalled(1_000, 11_001)).toBe(true);
  });
});

describe("stalledPath", () => {
  const paths = ["/a", "/b", "/c"];

  test("is the first file with no complete output line", () => {
    expect(stalledPath(paths, "")).toBe("/a");
    expect(stalledPath(paths, '{"path":"/a"}\n')).toBe("/b");
    expect(stalledPath(paths, '{"path":"/a"}\n{"path":"/b"}\n{"pa')).toBe("/c");
  });

  test("is null when every file has a line", () => {
    expect(stalledPath(paths, '{"a":1}\n{"a":2}\n{"a":3}\n')).toBeNull();
  });
});
