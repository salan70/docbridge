import { EXCLUDED_SUFFIXES, LANGUAGE_SUFFIXES } from "../../src/config/code-language";
import type { CodeLanguage } from "../../src/model/types";

/**
 * The pure parts of the parse-agreement check: choosing the files, classifying
 * one file's two verdicts, and summarizing. The runner owns the processes.
 */

/** The languages whose accept/reject verdicts the candidate must reproduce. */
export const AGREEMENT_LANGUAGES = [
  "typescript",
  "javascript",
  "rust",
  "go",
  "java",
  "python",
  "ruby",
] as const satisfies readonly CodeLanguage[];

export type AgreementLanguage = (typeof AGREEMENT_LANGUAGES)[number];

/** Directories the repository walk skips: dependencies, build output, and work trees. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "target",
  ".build",
  ".tmp",
  ".dart_tool",
  ".git",
  ".claude",
]);

export type Outcome = "bothAccept" | "bothReject" | "shippedOnly" | "candidateOnly";

export type AgreementRow = { language: AgreementLanguage; path: string; outcome: Outcome };

export type LanguageCounts = {
  files: number;
  bothAccept: number;
  bothReject: number;
  shippedOnly: number;
  candidateOnly: number;
};

export type AgreementSummary = {
  languages: Record<AgreementLanguage, LanguageCounts>;
  shippedOnly: string[];
  candidateOnly: string[];
};

/** The language that claims the path, or `undefined` for a declaration file or unknown suffix. */
export function languageOfPath(path: string): CodeLanguage | undefined {
  for (const [language, suffixes] of Object.entries(LANGUAGE_SUFFIXES) as [
    CodeLanguage,
    readonly string[],
  ][]) {
    const excluded = EXCLUDED_SUFFIXES[language].some((suffix) => path.endsWith(suffix));
    if (!excluded && suffixes.some((suffix) => path.endsWith(suffix))) {
      return language;
    }
  }
  return undefined;
}

export function isExcludedPath(path: string): boolean {
  return path.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

/** The sorted, unique paths of `language` that are outside the excluded directories. */
export function selectSourceFiles(paths: readonly string[], language: CodeLanguage): string[] {
  const selected = paths.filter(
    (path) => languageOfPath(path) === language && !isExcludedPath(path),
  );
  return [...new Set(selected)].toSorted();
}

/**
 * The path a file is scanned as. A conformance `input.txt` takes the language's
 * first suffix so that both parsers see the extension they dispatch on.
 */
export function scannedPathOf(path: string, language: CodeLanguage): string {
  const suffix = LANGUAGE_SUFFIXES[language][0] ?? "";
  return path.endsWith("/input.txt") ? `${path.slice(0, -".txt".length)}${suffix}` : path;
}

export function classify(shippedRejects: boolean, candidateAccepted: boolean): Outcome {
  if (shippedRejects) {
    return candidateAccepted ? "candidateOnly" : "bothReject";
  }
  return candidateAccepted ? "bothAccept" : "shippedOnly";
}

export type CandidateVerdict =
  | { path: string; accepted: boolean }
  | { path: string; unreadable: true };

/** One stdout line of `parser-gate parse`. */
export function parseCandidateLine(line: string): CandidateVerdict {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null || !("path" in value)) {
    throw new Error(`not a parse result: ${line}`);
  }
  const { path } = value;
  if (typeof path !== "string") {
    throw new Error(`not a parse result: ${line}`);
  }
  if ("unreadable" in value && value.unreadable === true) {
    return { path, unreadable: true };
  }
  if ("accepted" in value && typeof value.accepted === "boolean") {
    return { path, accepted: value.accepted };
  }
  throw new Error(`not a parse result: ${line}`);
}

export function summarizeAgreement(rows: readonly AgreementRow[]): AgreementSummary {
  const languages = Object.fromEntries(
    AGREEMENT_LANGUAGES.map((language) => [
      language,
      { files: 0, bothAccept: 0, bothReject: 0, shippedOnly: 0, candidateOnly: 0 },
    ]),
  ) as Record<AgreementLanguage, LanguageCounts>;
  const shippedOnly: string[] = [];
  const candidateOnly: string[] = [];
  for (const { language, path, outcome } of rows) {
    const counts = languages[language];
    counts.files += 1;
    counts[outcome] += 1;
    if (outcome === "shippedOnly") {
      shippedOnly.push(path);
    } else if (outcome === "candidateOnly") {
      candidateOnly.push(path);
    }
  }
  return { languages, shippedOnly, candidateOnly };
}

/** The check fails when the candidate rejects a file the shipped adapter accepts. */
export function agreementFails(summary: AgreementSummary): boolean {
  return summary.shippedOnly.length > 0;
}

const COLUMNS: readonly [string, keyof LanguageCounts][] = [
  ["files", "files"],
  ["both accept", "bothAccept"],
  ["both reject", "bothReject"],
  ["shipped only", "shippedOnly"],
  ["candidate only", "candidateOnly"],
];

export function formatAgreementTable(summary: AgreementSummary): string {
  const total: LanguageCounts = {
    files: 0,
    bothAccept: 0,
    bothReject: 0,
    shippedOnly: 0,
    candidateOnly: 0,
  };
  for (const counts of Object.values(summary.languages)) {
    for (const [, key] of COLUMNS) {
      total[key] += counts[key];
    }
  }
  const header = ["language", ...COLUMNS.map(([title]) => title)];
  const body = [
    ...AGREEMENT_LANGUAGES.map((language) => [language, summary.languages[language]] as const),
    ["TOTAL", total] as const,
  ].map(([name, counts]) => [name, ...COLUMNS.map(([, key]) => String(counts[key]))]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) =>
        index === 0 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [format(header), ...body.map(format)].join("\n");
}
