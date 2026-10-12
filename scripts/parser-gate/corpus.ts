import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The parser gate corpus: the pinned repositories, the files counted in each,
 * and the number of files kept for the gate. `corpus.json` mirrors the two
 * tables in the plan, and the tests keep the two in step.
 */
export type Language = "swift" | "dart";

export type CorpusSet = "development" | "holdout";

export type CorpusEntry = {
  rank: number;
  repository: string;
  commit: string;
  set: CorpusSet;
  counted: number;
  used: number;
};

export type Corpus = Record<Language, CorpusEntry[]>;

const CORPUS: Corpus = JSON.parse(readFileSync(join(import.meta.dir, "corpus.json"), "utf8"));

const PLAN_HEADINGS: Record<Language, string> = {
  swift: "### Swift repositories",
  dart: "### Dart repositories",
};

const EXCLUDED_SEGMENTS = new Set([
  "Pods",
  "Carthage",
  "vendor",
  "Vendor",
  "third_party",
  "ThirdParty",
  "node_modules",
  ".build",
  "build",
  "DerivedData",
  "generated",
  "Generated",
  "gen",
  ".dart_tool",
]);

const DART_GENERATED_SUFFIXES = [
  ".g.dart",
  ".freezed.dart",
  ".gr.dart",
  ".mocks.dart",
  ".pb.dart",
  ".pbenum.dart",
  ".pbjson.dart",
  ".pbgrpc.dart",
  ".config.dart",
];

/**
 * Whether a path at a pinned commit is a counted file. The caller checks that
 * the entry is a regular file, not a symbolic link.
 */
export function isCountedPath(language: Language, path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  if (!name.endsWith(`.${language}`)) {
    return false;
  }
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return false;
  }
  return language !== "dart" || !DART_GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Keeps `used` paths: the ones with the lowest SHA-256 of their repository-
 * relative path. A list no longer than `used` is kept whole. The result is in
 * path order.
 */
export function sampleFiles(paths: readonly string[], used: number): string[] {
  const kept =
    paths.length <= used
      ? [...paths]
      : paths
          .map((path) => ({ path, hash: sha256(path) }))
          .toSorted((left, right) => compareStrings(left.hash, right.hash))
          .slice(0, used)
          .map((entry) => entry.path);
  return kept.toSorted(compareStrings);
}

export function corpusEntries(language: Language, set?: CorpusSet): CorpusEntry[] {
  return CORPUS[language].filter((entry) => set === undefined || entry.set === set);
}

/**
 * Reads the two repository tables of the plan. The rows are returned in table
 * order, in the same shape as `corpus.json`.
 */
export function parsePlanTables(markdown: string): Corpus {
  const lines = markdown.split("\n");
  return {
    swift: parseTable(lines, PLAN_HEADINGS.swift),
    dart: parseTable(lines, PLAN_HEADINGS.dart),
  };
}

function parseTable(lines: readonly string[], heading: string): CorpusEntry[] {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`plan heading not found: ${heading}`);
  }
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) {
      break;
    }
    if (line.startsWith("|")) {
      rows.push(
        line
          .slice(1, line.lastIndexOf("|"))
          .split("|")
          .map((cell) => cell.trim()),
      );
    }
  }
  const [header = [], ...body] = rows.filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) {
      throw new Error(`plan table under "${heading}" has no ${name} column`);
    }
    return index;
  };
  const columns = {
    rank: column("Rank"),
    repository: column("Repository"),
    commit: column("Commit"),
    set: column("Set"),
    counted: column("Counted"),
    used: column("Used"),
  };
  return body.map((row) => ({
    rank: integer(cellAt(row, columns.rank)),
    repository: code(cellAt(row, columns.repository)),
    commit: commit(cellAt(row, columns.commit)),
    set: setName(cellAt(row, columns.set)),
    counted: integer(cellAt(row, columns.counted)),
    used: integer(cellAt(row, columns.used)),
  }));
}

function cellAt(row: readonly string[], index: number): string {
  const cell = row[index];
  if (cell === undefined) {
    throw new Error(`short table row: ${row.join(" | ")}`);
  }
  return cell;
}

function integer(cell: string): number {
  if (!/^[\d,]+$/.test(cell)) {
    throw new Error(`not an integer in the plan table: ${cell}`);
  }
  return Number(cell.replaceAll(",", ""));
}

function code(cell: string): string {
  return cell.replace(/^`(.*)`$/, "$1");
}

function commit(cell: string): string {
  const value = code(cell);
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`not a full commit in the plan table: ${cell}`);
  }
  return value;
}

function setName(cell: string): CorpusSet {
  if (cell !== "development" && cell !== "holdout") {
    throw new Error(`unknown set in the plan table: ${cell}`);
  }
  return cell;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
