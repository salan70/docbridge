import { firstDifference } from "./result-diff";

/**
 * How closely the candidate's declaration-scoped output matches the shipped
 * worker's on files the candidate rejects as a whole. The functions are pure:
 * the runner owns the worker calls. The scores are not part of the decision
 * rule.
 */
const PARSE_ERROR_CODE = "code_parse_error";

export type ScopeSymbol = { kind: string; canonicalId: string };

export type ScopeLink = { source: string; target: string; [field: string]: unknown };

export type ScopeDiagnostic = { code: string; target?: string };

/** The parts of one scanned file the comparison reads; other fields are compared as content. */
export type ScopeScan = {
  symbols: ScopeSymbol[];
  undocumentedSymbols: ScopeSymbol[];
  links: ScopeLink[];
  diagnostics: ScopeDiagnostic[];
};

export type Overlap = { shipped: number; candidate: number; both: number; identical: number };

export type FileScope = {
  repository: string;
  path: string;
  configuration: string;
  symbols: Overlap;
  links: Overlap;
  droppedDeclarations: number;
  wholeFile: boolean;
};

/**
 * The shipped and candidate items matched by key (one to one, in order, per
 * key), and how many matched pairs have the same content.
 */
export function overlapOf<T>(
  shipped: readonly T[],
  candidate: readonly T[],
  keyOf: (item: T) => string,
): Overlap {
  const remaining = new Map<string, T[]>();
  for (const item of shipped) {
    const key = keyOf(item);
    remaining.set(key, [...(remaining.get(key) ?? []), item]);
  }
  let both = 0;
  let identical = 0;
  for (const item of candidate) {
    const match = remaining.get(keyOf(item))?.shift();
    if (match !== undefined) {
      both += 1;
      if (firstDifference(match, item) === undefined) {
        identical += 1;
      }
    }
  }
  return { shipped: shipped.length, candidate: candidate.length, both, identical };
}

function symbolKey(symbol: ScopeSymbol): string {
  return JSON.stringify([symbol.kind, symbol.canonicalId]);
}

function linkKey(link: ScopeLink): string {
  return JSON.stringify([link.source, link.target]);
}

function symbolsOf(scan: ScopeScan): ScopeSymbol[] {
  return [...scan.symbols, ...scan.undocumentedSymbols];
}

type ScopeFileInput = {
  repository: string;
  path: string;
  configuration: string;
  /** The `filePath` the file was sent as. */
  filePath: string;
  shipped: ScopeScan;
  candidate: ScopeScan;
};

/** The comparison of one file's shipped scan and candidate declaration-scoped scan. */
export function scopeFile(input: ScopeFileInput): FileScope {
  const { shipped, candidate, filePath } = input;
  const parseErrors = candidate.diagnostics.filter(
    (diagnostic) => diagnostic.code === PARSE_ERROR_CODE,
  );
  return {
    repository: input.repository,
    path: input.path,
    configuration: input.configuration,
    symbols: overlapOf(symbolsOf(shipped), symbolsOf(candidate), symbolKey),
    links: overlapOf(shipped.links, candidate.links, linkKey),
    droppedDeclarations: parseErrors.filter((diagnostic) => diagnostic.target !== filePath).length,
    wholeFile: parseErrors.some((diagnostic) => diagnostic.target === filePath),
  };
}

/** The rows that are unmodified files the shipped worker accepts and the candidate does not. */
export function selectRejected<T extends { variant: string; shipped: string; candidate: string }>(
  rows: readonly T[],
): T[] {
  return rows.filter(
    (row) => row.variant === "unmodified" && row.shipped === "accept" && row.candidate !== "accept",
  );
}

export type OverlapScore = Overlap & {
  precision: number | null;
  recall: number | null;
  identicalRatio: number | null;
};

export type Aggregate = {
  files: number;
  wholeFileRejections: number;
  /** Files whose symbol recall is 1; a file with no shipped symbols has no recall. */
  fullRecallFiles: number;
  symbols: OverlapScore;
  links: OverlapScore;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function score(overlaps: readonly Overlap[]): OverlapScore {
  const sum = (field: keyof Overlap): number =>
    overlaps.reduce((total, overlap) => total + overlap[field], 0);
  const total: Overlap = {
    shipped: sum("shipped"),
    candidate: sum("candidate"),
    both: sum("both"),
    identical: sum("identical"),
  };
  return {
    ...total,
    precision: ratio(total.both, total.candidate),
    recall: ratio(total.both, total.shipped),
    identicalRatio: ratio(total.identical, total.both),
  };
}

export function aggregate(rows: readonly FileScope[]): Aggregate {
  return {
    files: rows.length,
    wholeFileRejections: rows.filter((row) => row.wholeFile).length,
    fullRecallFiles: rows.filter(
      (row) => row.symbols.shipped > 0 && row.symbols.both === row.symbols.shipped,
    ).length,
    symbols: score(rows.map((row) => row.symbols)),
    links: score(rows.map((row) => row.links)),
  };
}

export type ConfigurationReport = {
  overall: Aggregate;
  repositories: Record<string, Aggregate>;
};

export type ScopeReport = {
  language: string;
  set: string;
  overall: Aggregate;
  configurations: Record<string, ConfigurationReport>;
  files: FileScope[];
};

/** Aggregates for all rows, each configuration and each repository within it, in name order. */
export function reportOf(language: string, set: string, files: readonly FileScope[]): ScopeReport {
  const configurations: Record<string, ConfigurationReport> = {};
  for (const configuration of [...new Set(files.map((row) => row.configuration))].toSorted()) {
    const inConfiguration = files.filter((row) => row.configuration === configuration);
    const repositories: Record<string, Aggregate> = {};
    for (const name of [...new Set(inConfiguration.map((row) => row.repository))].toSorted()) {
      repositories[name] = aggregate(inConfiguration.filter((row) => row.repository === name));
    }
    configurations[configuration] = { overall: aggregate(inConfiguration), repositories };
  }
  return { language, set, overall: aggregate(files), configurations, files: [...files] };
}

function percent(value: number | null): string {
  return value === null ? "-" : value.toFixed(4);
}

const COLUMNS: readonly { title: string; value: (stats: Aggregate) => string }[] = [
  { title: "files", value: (s) => String(s.files) },
  { title: "whole", value: (s) => String(s.wholeFileRejections) },
  { title: "fullRec", value: (s) => String(s.fullRecallFiles) },
  { title: "symShip", value: (s) => String(s.symbols.shipped) },
  { title: "symCand", value: (s) => String(s.symbols.candidate) },
  { title: "symBoth", value: (s) => String(s.symbols.both) },
  { title: "symPrec", value: (s) => percent(s.symbols.precision) },
  { title: "symRec", value: (s) => percent(s.symbols.recall) },
  { title: "symSame", value: (s) => percent(s.symbols.identicalRatio) },
  { title: "linkPrec", value: (s) => percent(s.links.precision) },
  { title: "linkRec", value: (s) => percent(s.links.recall) },
  { title: "linkSame", value: (s) => percent(s.links.identicalRatio) },
];

/** A fixed-width table with one row per configuration and repository, and a `TOTAL` row. */
export function formatScopeTable(report: ScopeReport): string {
  const rows: [string, Aggregate][] = [];
  for (const [configuration, entry] of Object.entries(report.configurations)) {
    for (const [name, stats] of Object.entries(entry.repositories)) {
      rows.push([`${configuration} ${name}`, stats]);
    }
    rows.push([`${configuration} (all)`, entry.overall]);
  }
  rows.push(["TOTAL", report.overall]);
  const cells = rows.map(([name, stats]) => [name, ...COLUMNS.map((c) => c.value(stats))]);
  const header = ["configuration repository", ...COLUMNS.map((column) => column.title)];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [format(header), ...cells.map(format)].join("\n");
}
