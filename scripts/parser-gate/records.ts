import { firstDifference } from "./result-diff";
import type { ExpectedLink, ReportedSymbol } from "./variants";

/**
 * The records of one measured (file, variant, configuration) and their
 * summary. The functions are pure: the runner owns the worker calls.
 */
const PARSE_ERROR_CODE = "code_parse_error";

type Position = { line: number; column: number };

export type ScannedLink = { source: string; target: string; location: Position };

export type ScannedDiagnostic = { code: string; location?: Position };

/** The parts of one scanned file the gate compares. */
export type ScannedFile = {
  symbols: ReportedSymbol[];
  undocumentedSymbols: ReportedSymbol[];
  links: ScannedLink[];
  diagnostics: ScannedDiagnostic[];
};

/** A target's result for one file: its scan, or `"failed"` when none could be had. */
export type TargetResult = ScannedFile | "failed";

export type Status = "accept" | "reject" | "failed";

export type Count = { shipped: number; candidate: number; missing: number; extra: number };

export type InjectedCheck = { symbol: string; shippedOk: boolean; candidateOk: boolean };

export type RecordMeta = {
  language: string;
  set: string;
  repository: string;
  path: string;
  contentSha256: string;
  variant: string;
  configuration: string;
};

export type GateRecord = RecordMeta & {
  shipped: Status;
  candidate: Status;
  identical: boolean;
  firstDifference?: string;
  symbols: Count;
  links: Count;
  rejection?: { shipped?: Position; candidate?: Position };
  injected?: InjectedCheck;
  /** On an unmodified row the candidate rejected: the construct it rejected, or `null`. */
  construct?: string | null;
};

/** The visibility each configuration sends, always explicit. */
export const CONFIGURATIONS: Readonly<
  Record<"swift" | "dart", Readonly<Record<string, readonly string[]>>>
> = {
  swift: { default: ["public", "open"], internal: ["public", "open", "internal"] },
  dart: { default: ["public"] },
};

export function statusOf(result: TargetResult): Status {
  if (result === "failed") {
    return "failed";
  }
  return result.diagnostics.some((diagnostic) => diagnostic.code === PARSE_ERROR_CODE)
    ? "reject"
    : "accept";
}

/** How the multiset `candidate` differs from `shipped`; a failed side counts as empty. */
export function multisetDifference(
  shipped: readonly string[],
  candidate: readonly string[],
): Count {
  const remaining = new Map<string, number>();
  for (const key of shipped) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let extra = 0;
  for (const key of candidate) {
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
    } else {
      extra += 1;
    }
  }
  const missing = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  return { shipped: shipped.length, candidate: candidate.length, missing, extra };
}

/** The `canonicalId`s of the symbols and the undocumented symbols together. */
function symbolKeys(result: TargetResult): string[] {
  return result === "failed"
    ? []
    : [...result.symbols, ...result.undocumentedSymbols].map((symbol) => symbol.canonicalId);
}

function linkKey(link: ScannedLink): string {
  return JSON.stringify([link.source, link.target]);
}

function linkKeys(result: TargetResult): string[] {
  return result === "failed" ? [] : result.links.map(linkKey);
}

function comparable(result: ScannedFile): unknown {
  return {
    symbols: result.symbols,
    undocumentedSymbols: result.undocumentedSymbols,
    links: result.links,
    diagnostics: result.diagnostics,
  };
}

function rejectionLocation(result: TargetResult): Position | undefined {
  if (result === "failed") {
    return undefined;
  }
  return result.diagnostics.find((diagnostic) => diagnostic.code === PARSE_ERROR_CODE)?.location;
}

/** One record from the two targets' results for the same request file. */
export function buildRecord(
  meta: RecordMeta,
  shipped: TargetResult,
  candidate: TargetResult,
  injected?: InjectedCheck,
): GateRecord {
  const difference =
    shipped === "failed" || candidate === "failed"
      ? undefined
      : firstDifference(comparable(shipped), comparable(candidate));
  const identical = shipped !== "failed" && candidate !== "failed" && difference === undefined;
  const shippedRejection = rejectionLocation(shipped);
  const candidateRejection = rejectionLocation(candidate);
  const rejection = {
    ...(shippedRejection === undefined ? {} : { shipped: shippedRejection }),
    ...(candidateRejection === undefined ? {} : { candidate: candidateRejection }),
  };
  return {
    ...meta,
    shipped: statusOf(shipped),
    candidate: statusOf(candidate),
    identical,
    ...(difference === undefined ? {} : { firstDifference: difference }),
    symbols: multisetDifference(symbolKeys(shipped), symbolKeys(candidate)),
    links: multisetDifference(linkKeys(shipped), linkKeys(candidate)),
    ...(Object.keys(rejection).length === 0 ? {} : { rejection }),
    ...(injected === undefined ? {} : { injected }),
  };
}

/**
 * Whether the injected variant's scan differs from the unmodified scan by
 * exactly the one expected link: no link lost, one gained with the expected
 * `source` and `target`, and that link found at the expected location. The
 * other links are compared by `source` and `target` because the insertion
 * moves the ones after it.
 */
export function checkInjection(
  base: TargetResult,
  injected: TargetResult,
  expected: ExpectedLink,
): boolean {
  if (statusOf(base) !== "accept" || statusOf(injected) !== "accept") {
    return false;
  }
  const [before, after] = [base, injected] as ScannedFile[];
  const difference = multisetDifference(
    before?.links.map(linkKey) ?? [],
    after?.links.map(linkKey) ?? [],
  );
  if (difference.missing !== 0 || difference.extra !== 1) {
    return false;
  }
  const expectedKey = linkKey(expected);
  const counts = (links: readonly ScannedLink[]): number =>
    links.filter((link) => linkKey(link) === expectedKey).length;
  if (counts(after?.links ?? []) !== counts(before?.links ?? []) + 1) {
    return false;
  }
  return (after?.links ?? []).some(
    (link) =>
      linkKey(link) === expectedKey &&
      link.location.line === expected.location.line &&
      link.location.column === expected.location.column,
  );
}

export type VariantStats = { acceptedByBoth: number; notIdentical: number };

export type Stats = {
  files: number;
  shippedFailed: number;
  shippedAccepted: number;
  candidateRejected: number;
  rejectionRate: number | null;
  acceptedByBoth: number;
  notIdentical: number;
  byVariant: Record<string, VariantStats>;
  injectedChecks: { rows: number; shippedNotOk: number; candidateNotOk: number };
  /** Counts of malformed rows by `<shipped><candidate>`; `failed` is any failed side. */
  malformed: {
    acceptAccept: number;
    acceptReject: number;
    rejectAccept: number;
    rejectReject: number;
    failed: number;
  };
  candidateOnlyAccepted: number;
};

export type Summary = {
  overall: Stats;
  /**
   * Files the shipped worker accepts and the candidate rejects, by the
   * construct it rejected, in the default configuration, most frequent first.
   */
  constructs: Record<string, number>;
  repositories: Record<string, Stats>;
  /** The inputs of the plan's decision rule; the verdict is left to the reader. */
  rule: {
    rejectionRate: number | null;
    maxRepositoryRejectionRate: number | null;
    maxRepository: string | null;
    notIdentical: number;
    injectedFailures: { shipped: number; candidate: number };
  };
};

const DEFAULT_CONFIGURATION = "default";

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function statsOf(records: readonly GateRecord[]): Stats {
  const stats: Stats = {
    files: 0,
    shippedFailed: 0,
    shippedAccepted: 0,
    candidateRejected: 0,
    rejectionRate: null,
    acceptedByBoth: 0,
    notIdentical: 0,
    byVariant: {},
    injectedChecks: { rows: 0, shippedNotOk: 0, candidateNotOk: 0 },
    malformed: { acceptAccept: 0, acceptReject: 0, rejectAccept: 0, rejectReject: 0, failed: 0 },
    candidateOnlyAccepted: 0,
  };
  for (const row of records) {
    if (row.variant === "unmodified" && row.configuration === DEFAULT_CONFIGURATION) {
      countFile(stats, row);
    }
    if (row.shipped === "accept" && row.candidate === "accept") {
      countAcceptedByBoth(stats, row);
    }
    if (row.injected !== undefined) {
      stats.injectedChecks.rows += 1;
      stats.injectedChecks.shippedNotOk += row.injected.shippedOk ? 0 : 1;
      stats.injectedChecks.candidateNotOk += row.injected.candidateOk ? 0 : 1;
    }
    if (row.variant.startsWith("malformed:")) {
      countMalformed(stats, row);
    }
  }
  stats.rejectionRate = rate(stats.candidateRejected, stats.shippedAccepted);
  return stats;
}

function countFile(stats: Stats, row: GateRecord): void {
  stats.files += 1;
  if (row.shipped === "failed") {
    stats.shippedFailed += 1;
  }
  if (row.shipped === "accept") {
    stats.shippedAccepted += 1;
    if (row.candidate !== "accept") {
      stats.candidateRejected += 1;
    }
  }
  if (row.shipped === "reject" && row.candidate === "accept") {
    stats.candidateOnlyAccepted += 1;
  }
}

function countAcceptedByBoth(stats: Stats, row: GateRecord): void {
  const variant = (stats.byVariant[row.variant] ??= { acceptedByBoth: 0, notIdentical: 0 });
  stats.acceptedByBoth += 1;
  variant.acceptedByBoth += 1;
  if (!row.identical) {
    stats.notIdentical += 1;
    variant.notIdentical += 1;
  }
}

function countMalformed(stats: Stats, row: GateRecord): void {
  if (row.shipped === "failed" || row.candidate === "failed") {
    stats.malformed.failed += 1;
  } else if (row.shipped === "accept") {
    stats.malformed[row.candidate === "accept" ? "acceptAccept" : "acceptReject"] += 1;
  } else {
    stats.malformed[row.candidate === "accept" ? "rejectAccept" : "rejectReject"] += 1;
  }
}

function countConstructs(records: readonly GateRecord[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of records) {
    if (
      row.variant === "unmodified" &&
      row.configuration === DEFAULT_CONFIGURATION &&
      row.shipped === "accept" &&
      row.candidate === "reject"
    ) {
      const name = row.construct ?? "unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts].toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b, "en")),
  );
}

/** Statistics for all records and for each repository, in name order. */
export function summarize(records: readonly GateRecord[]): Summary {
  const overall = statsOf(records);
  const names = [...new Set(records.map((row) => row.repository))].toSorted();
  const repositories: Record<string, Stats> = {};
  for (const name of names) {
    repositories[name] = statsOf(records.filter((row) => row.repository === name));
  }
  let worst: { name: string; rate: number } | undefined;
  for (const [name, stats] of Object.entries(repositories)) {
    if (stats.rejectionRate !== null && (worst === undefined || stats.rejectionRate > worst.rate)) {
      worst = { name, rate: stats.rejectionRate };
    }
  }
  return {
    overall,
    constructs: countConstructs(records),
    repositories,
    rule: {
      rejectionRate: overall.rejectionRate,
      maxRepositoryRejectionRate: worst?.rate ?? null,
      maxRepository: worst?.name ?? null,
      notIdentical: overall.notIdentical,
      injectedFailures: {
        shipped: overall.injectedChecks.shippedNotOk,
        candidate: overall.injectedChecks.candidateNotOk,
      },
    },
  };
}

/**
 * The construct of each path in the output of `parser-gate parse`: the
 * rejected construct, or `null` when the file was accepted or none was given.
 */
export function parseConstructs(stdout: string): Map<string, string | null> {
  const constructs = new Map<string, string | null>();
  for (const line of stdout.split("\n").filter((text) => text.trim() !== "")) {
    const entry: unknown = JSON.parse(line);
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("path" in entry) ||
      typeof entry.path !== "string"
    ) {
      throw new Error(`malformed parse line: ${line}`);
    }
    const construct = "construct" in entry ? entry.construct : null;
    constructs.set(entry.path, typeof construct === "string" ? construct : null);
  }
  return constructs;
}

/** The row with its `construct`, when it is an unmodified row the candidate rejected. */
export function withConstruct(row: GateRecord, construct: string | null | undefined): GateRecord {
  if (row.variant !== "unmodified" || row.candidate !== "reject") {
    return row;
  }
  return { ...row, construct: construct ?? null };
}

export type FileListEntry = { repository: string; path: string; file: string };

/** The entries of a corpus `*.files.jsonl`. */
export function parseFileList(text: string): FileListEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const entry: unknown = JSON.parse(line);
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("repository" in entry) ||
        !("path" in entry) ||
        !("file" in entry) ||
        typeof entry.repository !== "string" ||
        typeof entry.path !== "string" ||
        typeof entry.file !== "string"
      ) {
        throw new Error(`malformed file list entry: ${line}`);
      }
      return { repository: entry.repository, path: entry.path, file: entry.file };
    });
}

/** The `filePath` a corpus file is sent as. */
export function requestFilePath(repository: string, path: string): string {
  return `${repository.replaceAll("/", "__")}/${path}`;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * The response files in the order of the requested paths, or `undefined` when
 * a requested path is missing or appears more than once.
 */
export function alignResponse<T extends { filePath: string }>(
  paths: readonly string[],
  files: readonly T[],
): T[] | undefined {
  const aligned: T[] = [];
  for (const path of paths) {
    const matches = files.filter((file) => file.filePath === path);
    const [only] = matches;
    if (matches.length !== 1 || only === undefined) {
      return undefined;
    }
    aligned.push(only);
  }
  return aligned;
}

const TABLE_COLUMNS: readonly { title: string; value: (stats: Stats) => string }[] = [
  { title: "files", value: (s) => String(s.files) },
  { title: "shipFail", value: (s) => String(s.shippedFailed) },
  { title: "shipAcc", value: (s) => String(s.shippedAccepted) },
  { title: "candRej", value: (s) => String(s.candidateRejected) },
  { title: "rejRate", value: (s) => (s.rejectionRate === null ? "-" : s.rejectionRate.toFixed(4)) },
  { title: "both", value: (s) => String(s.acceptedByBoth) },
  { title: "notIdent", value: (s) => String(s.notIdentical) },
  { title: "injRows", value: (s) => String(s.injectedChecks.rows) },
  { title: "injShip", value: (s) => String(s.injectedChecks.shippedNotOk) },
  { title: "injCand", value: (s) => String(s.injectedChecks.candidateNotOk) },
  { title: "malAA", value: (s) => String(s.malformed.acceptAccept) },
  { title: "malAR", value: (s) => String(s.malformed.acceptReject) },
  { title: "malRA", value: (s) => String(s.malformed.rejectAccept) },
  { title: "malRR", value: (s) => String(s.malformed.rejectReject) },
  { title: "malFail", value: (s) => String(s.malformed.failed) },
  { title: "candOnly", value: (s) => String(s.candidateOnlyAccepted) },
];

/** A fixed-width table with one row per repository and a `TOTAL` row. */
export function formatTable(summary: Summary): string {
  const rows: [string, Stats][] = [
    ...Object.entries(summary.repositories),
    ["TOTAL", summary.overall],
  ];
  const nameWidth = Math.max("repository".length, ...rows.map(([name]) => name.length));
  const cells = rows.map(([name, stats]) => [name, ...TABLE_COLUMNS.map((c) => c.value(stats))]);
  const header = ["repository", ...TABLE_COLUMNS.map((column) => column.title)];
  const widths = header.map((title, index) =>
    index === 0
      ? nameWidth
      : Math.max(title.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [format(header), ...cells.map(format)].join("\n");
}
