import { createHash } from "node:crypto";

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

/** A path with the platform's separator replaced by `/`, so a path means the same on every OS. */
export function toPosixPath(path: string, separator: string): string {
  return path.split(separator).join("/");
}

/** The candidate's verdict on one file; the digest holds no content, so CRLF checkouts agree. */
export type DigestEntry = { language: AgreementLanguage; path: string; accepted: boolean };

export type LanguageDigest = { files: number; accepted: number; rejected: number; sha256: string };

export type ParseDigest = {
  languages: Record<AgreementLanguage, LanguageDigest>;
  /** The SHA-256 of every language's lines together, in path order. */
  sha256: string;
};

function digestLine(entry: DigestEntry): string {
  return `${entry.path}\t${entry.accepted ? "accept" : "reject"}`;
}

/** UTF-16 code unit order, which no locale changes. */
function byPath(left: DigestEntry, right: DigestEntry): number {
  if (left.path === right.path) {
    return 0;
  }
  return left.path < right.path ? -1 : 1;
}

function sha256Of(entries: readonly DigestEntry[]): string {
  const text = entries.toSorted(byPath).map(digestLine).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The per-language and overall digests of the candidate's verdicts. A digest
 * hashes `<path>\t<accept|reject>` lines in ascending path order, joined by LF.
 */
export function computeDigest(entries: readonly DigestEntry[]): ParseDigest {
  const languages = Object.fromEntries(
    AGREEMENT_LANGUAGES.map((language) => {
      const own = entries.filter((entry) => entry.language === language);
      const accepted = own.filter((entry) => entry.accepted).length;
      return [
        language,
        { files: own.length, accepted, rejected: own.length - accepted, sha256: sha256Of(own) },
      ];
    }),
  ) as Record<AgreementLanguage, LanguageDigest>;
  return { languages, sha256: sha256Of(entries) };
}

export function formatDigestTable(digest: ParseDigest): string {
  const header = ["language", "files", "accepted", "rejected", "sha256"];
  const total = Object.values(digest.languages).reduce(
    (sum, counts) => ({
      files: sum.files + counts.files,
      accepted: sum.accepted + counts.accepted,
      rejected: sum.rejected + counts.rejected,
    }),
    { files: 0, accepted: 0, rejected: 0 },
  );
  const body = [
    ...AGREEMENT_LANGUAGES.map((language) => [language, digest.languages[language]] as const),
    ["ALL", { ...total, sha256: digest.sha256 }] as const,
  ].map(([name, counts]) => [
    name,
    String(counts.files),
    String(counts.accepted),
    String(counts.rejected),
    counts.sha256,
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        return index === 0 || index === row.length - 1 ? cell.padEnd(width) : cell.padStart(width);
      })
      .join("  ")
      .trimEnd();
  return [format(header), ...body.map(format)].join("\n");
}

/** The path of a built executable: the `.exe` suffix is the platform's, not the build recipe's. */
export function executablePath(path: string, platform: string): string {
  return platform === "win32" ? `${path}.exe` : path;
}
