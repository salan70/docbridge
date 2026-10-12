/**
 * The pure parts of the corpus timing check: reading the candidate's output,
 * summarizing parse times, and reading the peak memory from `/usr/bin/time`.
 */

/** No corpus file may take longer than this (10 s) to parse. */
export const OVER_LIMIT_MICROS = 10_000_000;

export type TimingSample = { path: string; micros: number };

export type TimingStats = {
  files: number;
  totalMicros: number;
  medianMicros: number;
  p99Micros: number;
  maxMicros: number;
  /** The path of the slowest sample, or `null` for an empty set. */
  slowestPath: string | null;
  overLimit: number;
};

/** One stdout line of `parser-gate parse`: the path and its parse time. */
export function parseTimingLine(line: string): TimingSample {
  const value: unknown = JSON.parse(line);
  if (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "micros" in value &&
    typeof value.path === "string" &&
    typeof value.micros === "number"
  ) {
    return { path: value.path, micros: value.micros };
  }
  throw new Error(`not a timed parse result: ${line}`);
}

/** The nearest-rank percentile of an ascending list. */
function percentile(ascending: readonly number[], rank: number): number {
  const index = Math.ceil((rank / 100) * ascending.length) - 1;
  return ascending[Math.max(0, index)] ?? 0;
}

function median(ascending: readonly number[]): number {
  const middle = Math.floor(ascending.length / 2);
  if (ascending.length === 0) {
    return 0;
  }
  const upper = ascending[middle] ?? 0;
  return ascending.length % 2 === 1 ? upper : ((ascending[middle - 1] ?? 0) + upper) / 2;
}

export function summarizeTiming(samples: readonly TimingSample[]): TimingStats {
  const ascending = samples.map((sample) => sample.micros).toSorted((a, b) => a - b);
  let slowest: TimingSample | undefined;
  for (const sample of samples) {
    if (slowest === undefined || sample.micros > slowest.micros) {
      slowest = sample;
    }
  }
  return {
    files: samples.length,
    totalMicros: ascending.reduce((sum, micros) => sum + micros, 0),
    medianMicros: median(ascending),
    p99Micros: percentile(ascending, 99),
    maxMicros: ascending.at(-1) ?? 0,
    slowestPath: slowest?.path ?? null,
    overLimit: samples.filter((sample) => sample.micros > OVER_LIMIT_MICROS).length,
  };
}

/** The `/usr/bin/time` flag that reports the peak resident set size, or `null` for the platform. */
export function timeCommandFlag(platform: string): "-l" | "-v" | null {
  if (platform === "darwin") {
    return "-l";
  }
  return platform === "linux" ? "-v" : null;
}

/** The peak resident set size in bytes from a `/usr/bin/time` report, or `null` when it has none. */
export function parseMaxRss(report: string, platform: string): number | null {
  const pattern =
    platform === "darwin"
      ? /^\s*(\d+)\s+maximum resident set size\s*$/m
      : /^\s*Maximum resident set size \(kbytes\):\s*(\d+)\s*$/m;
  const digits = pattern.exec(report)?.[1];
  if (digits === undefined) {
    return null;
  }
  return platform === "darwin" ? Number(digits) : Number(digits) * 1024;
}

export type TimingRow = { language: string; stats: TimingStats; maxRssBytes: number | null };

const MEGABYTE = 1024 * 1024;

function millis(micros: number): string {
  return (micros / 1000).toFixed(1);
}

export function formatTimingTable(rows: readonly TimingRow[]): string {
  const header = [
    "language",
    "files",
    "total ms",
    "median ms",
    "p99 ms",
    "max ms",
    "over 10 s",
    "max RSS MB",
    "slowest",
  ];
  const body = rows.map(({ language, stats, maxRssBytes }) => [
    language,
    String(stats.files),
    millis(stats.totalMicros),
    millis(stats.medianMicros),
    millis(stats.p99Micros),
    millis(stats.maxMicros),
    String(stats.overLimit),
    maxRssBytes === null ? "n/a" : (maxRssBytes / MEGABYTE).toFixed(1),
    stats.slowestPath ?? "-",
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((row) => row[index]?.length ?? 0)),
  );
  const last = header.length - 1;
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        return index === 0 || index === last ? cell.padEnd(width) : cell.padStart(width);
      })
      .join("  ")
      .trimEnd();
  return [format(header), ...body.map(format)].join("\n");
}
