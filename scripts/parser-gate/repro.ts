import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokeScannerWorker } from "../../src/scan/code/worker/scanner-worker";
import { statusOf } from "./records";
import type { ScannedFile } from "./records";
import {
  type GateLanguage,
  type GateTarget,
  firstDifference,
  specifiedRequest,
} from "./result-diff";
import { resolveWorkerCommand } from "./target";

/**
 * Checks the parser gate's hand-written reproductions. Each case holds an
 * `input.txt` and a `case.json` naming whether the shipped worker and the
 * candidate accept it. With `--causes <set>` it also checks that the set's
 * cause file only names causes that have a case, and that it covers every
 * file the measured records show the candidate rejecting alone or scanning
 * differently.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

const REPRO_ROOT = join(REPO_ROOT, "test-fixtures/parser-gate/repro");

const RESULTS_ROOT = join(REPO_ROOT, ".tmp/parser-gate/results");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

const KINDS = ["grammar", "candidate", "worker", "fixture"] as const;

const SETS = ["development", "holdout"] as const;

type Kind = (typeof KINDS)[number];

type Verdict = "accept" | "reject";

export type CaseSpec = {
  kind: Kind;
  construct: string;
  shipped: Verdict;
  candidate: Verdict;
  identical?: boolean;
};

type ReproArgs = {
  languages: readonly GateLanguage[];
  causes: (typeof SETS)[number] | undefined;
};

export function parseArgs(argv: readonly string[]): ReproArgs {
  let languages = LANGUAGES;
  let causes: ReproArgs["causes"];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--causes") {
      const set = SETS.find((candidate) => candidate === argv[index + 1]);
      if (set === undefined) {
        throw new Error(`--causes needs "development" or "holdout"`);
      }
      causes = set;
      index += 1;
    } else if (arg === "swift" || arg === "dart") {
      languages = [arg];
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return { languages, causes };
}

function isVerdict(value: unknown): value is Verdict {
  return value === "accept" || value === "reject";
}

/** The validated contents of a `case.json`; throws on any other shape. */
export function parseCase(value: unknown): CaseSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("case.json must be an object");
  }
  const { kind, construct, shipped, candidate, identical, ...extra } = value as Record<
    string,
    unknown
  >;
  const unknownKeys = Object.keys(extra);
  if (unknownKeys.length > 0) {
    throw new Error(`case.json has unknown keys: ${unknownKeys.join(", ")}`);
  }
  if (!KINDS.some((allowed) => allowed === kind)) {
    throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  }
  if (typeof construct !== "string" || construct === "") {
    throw new Error("construct must be a non-empty string");
  }
  if (!isVerdict(shipped) || !isVerdict(candidate)) {
    throw new Error(`shipped and candidate must be "accept" or "reject"`);
  }
  const bothAccept = shipped === "accept" && candidate === "accept";
  if (bothAccept && typeof identical !== "boolean") {
    throw new Error("identical is required when both accept");
  }
  if (!bothAccept && identical !== undefined) {
    throw new Error("identical applies only when both accept");
  }
  return {
    kind: kind as Kind,
    construct,
    shipped,
    candidate,
    ...(typeof identical === "boolean" ? { identical } : {}),
  };
}

function comparable(file: ScannedFile): unknown {
  return {
    symbols: file.symbols,
    undocumentedSymbols: file.undocumentedSymbols,
    links: file.links,
    diagnostics: file.diagnostics,
  };
}

/** What differs between a case's expectation and the two scans, or `undefined` when none. */
export function caseMismatch(
  spec: CaseSpec,
  shipped: ScannedFile | undefined,
  candidate: ScannedFile | undefined,
): string | undefined {
  if (shipped === undefined || candidate === undefined) {
    return `${shipped === undefined ? "shipped" : "candidate"} worker failed`;
  }
  const actualShipped = statusOf(shipped);
  const actualCandidate = statusOf(candidate);
  if (actualShipped !== spec.shipped) {
    return `shipped ${actualShipped}, expected ${spec.shipped}`;
  }
  if (actualCandidate !== spec.candidate) {
    return `candidate ${actualCandidate}, expected ${spec.candidate}`;
  }
  if (spec.identical !== undefined) {
    const identical = firstDifference(comparable(shipped), comparable(candidate)) === undefined;
    if (identical !== spec.identical) {
      return `identical ${identical}, expected ${spec.identical}`;
    }
  }
  return undefined;
}

type RecordRow = {
  repository: string;
  path: string;
  variant: string;
  configuration: string;
  shipped: string;
  candidate: string;
  identical: boolean;
};

/**
 * The `<repository>/<path>` keys of the unmodified files the shipped worker
 * accepts and the candidate either rejects or scans differently, in any
 * configuration.
 */
export function differingFiles(rows: readonly RecordRow[]): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.variant === "unmodified" &&
          row.shipped === "accept" &&
          (row.candidate !== "accept" || !row.identical),
      )
      .map((row) => `${row.repository}/${row.path}`),
  );
}

/**
 * Problems in a cause file; `differing` is `undefined` when no records were
 * measured. A file that has causes and no longer differs is one the candidate
 * was fixed for, and is not a problem.
 */
export function causesProblems(
  causes: Readonly<Record<string, readonly string[]>>,
  known: ReadonlySet<string>,
  differing: ReadonlySet<string> | undefined,
): string[] {
  const problems: string[] = [];
  for (const [file, names] of Object.entries(causes)) {
    if (names.length === 0) {
      problems.push(`${file}: no cause`);
    }
    for (const name of names) {
      if (!known.has(name)) {
        problems.push(`${file}: cause ${name} has no case`);
      }
    }
  }
  for (const file of differing ?? []) {
    if (!(file in causes)) {
      problems.push(`${file}: differs but has no causes`);
    }
  }
  return problems;
}

function caseNames(language: GateLanguage): string[] {
  const dir = join(REPRO_ROOT, language);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

async function scan(
  target: GateTarget,
  language: GateLanguage,
  name: string,
  content: string,
): Promise<ScannedFile | undefined> {
  const request = specifiedRequest(language, content, {}, `parser-gate-repro-${language}-${name}`);
  const result = await invokeScannerWorker(request, resolveWorkerCommand(target, language)).promise;
  return result.ok ? result.codeFiles[0] : undefined;
}

async function checkCases(language: GateLanguage): Promise<boolean> {
  let failed = false;
  for (const name of caseNames(language)) {
    const dir = join(REPRO_ROOT, language, name);
    const label = `${language}/${name}`;
    try {
      const spec = parseCase(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")));
      const content = readFileSync(join(dir, "input.txt"), "utf8");
      const mismatch = caseMismatch(
        spec,
        await scan("shipped", language, name, content),
        await scan("candidate", language, name, content),
      );
      console.log(mismatch === undefined ? `ok   ${label}` : `FAIL ${label} (${mismatch})`);
      failed ||= mismatch !== undefined;
    } catch (error) {
      console.log(`FAIL ${label} (${error instanceof Error ? error.message : String(error)})`);
      failed = true;
    }
  }
  return failed;
}

function checkCauses(language: GateLanguage, set: string): boolean {
  const causesPath = join(REPRO_ROOT, language, `${set}.causes.json`);
  const label = `${language}/${set}.causes.json`;
  if (!existsSync(causesPath)) {
    console.log(`FAIL ${label} (missing)`);
    return true;
  }
  const causes: Record<string, string[]> = JSON.parse(readFileSync(causesPath, "utf8"));
  const recordsPath = join(RESULTS_ROOT, set, `${language}.records.jsonl`);
  const differing = existsSync(recordsPath)
    ? differingFiles(
        readFileSync(recordsPath, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as RecordRow),
      )
    : undefined;
  const problems = causesProblems(causes, new Set(caseNames(language)), differing);
  for (const problem of problems) {
    console.log(`FAIL ${label} (${problem})`);
  }
  if (problems.length === 0) {
    console.log(`ok   ${label} (${Object.keys(causes).length} files)`);
  }
  return problems.length > 0;
}

async function main(): Promise<number> {
  const { languages, causes } = parseArgs(process.argv.slice(2));
  if (causes === undefined && languages.every((language) => caseNames(language).length === 0)) {
    console.log("no cases");
    return 0;
  }
  let failed = false;
  for (const language of languages) {
    failed = (await checkCases(language)) || failed;
    if (causes !== undefined) {
      failed = checkCauses(language, causes) || failed;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
