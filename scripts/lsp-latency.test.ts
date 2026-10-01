import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { formatLatencyReport, measureLatency, parseLatencyArgs, percentile } from "./lsp-latency";

const repoRoot = resolve(import.meta.dir, "..");

describe(parseLatencyArgs, () => {
  test("defaults to 20 server starts with 5 edits each", () => {
    expect(parseLatencyArgs([])).toEqual({ runs: 20, edits: 5 });
  });

  test("reads --runs and --edits", () => {
    expect(parseLatencyArgs(["--edits", "2", "--runs", "3"])).toEqual({ runs: 3, edits: 2 });
  });

  test.each([
    [["--iterations", "3"], "Unknown argument: --iterations. Usage: [--runs N] [--edits N]"],
    [["--runs"], "--runs takes a positive integer."],
    [["--edits", "0"], "--edits takes a positive integer."],
    [["--runs", "1.5"], "--runs takes a positive integer."],
  ])("rejects %j", (args, message) => {
    expect(() => parseLatencyArgs(args)).toThrow(message);
  });
});

describe(percentile, () => {
  test("takes the nearest rank of the sorted samples", () => {
    const samples = [50, 10, 40, 20, 30];

    expect(percentile(samples, 50)).toBe(30);
    expect(percentile(samples, 95)).toBe(50);
    expect(percentile(samples, 100)).toBe(50);
  });

  test("ranks 95 of 20 samples at the 19th", () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);

    expect(percentile(samples, 95)).toBe(19);
  });

  test("needs a sample", () => {
    expect(() => percentile([], 50)).toThrow("A percentile needs at least one sample.");
  });
});

test("formatLatencyReport prints the count, p50, p95, and maximum of each kind", () => {
  expect(formatLatencyReport({ cold: [900.4, 1100.6], warm: [300, 310.2, 290] })).toBe(
    "cold (server start to first publish): n=2 p50=900 ms p95=1101 ms max=1101 ms\n" +
      "warm (edit to the next publish): n=3 p50=300 ms p95=310 ms max=310 ms",
  );
});

test("measureLatency times a cold start and an edit on the Java example", async () => {
  const samples = await measureLatency(
    ["bun", "run", resolve(repoRoot, "src/cli/index.ts"), "lsp"],
    { runs: 1, edits: 1 },
  );

  expect(samples.cold).toHaveLength(1);
  expect(samples.warm).toHaveLength(1);
  for (const value of [...samples.cold, ...samples.warm]) {
    expect(value).toBeGreaterThan(0);
  }
}, 120_000);
