import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  type TimingRow,
  formatTimingTable,
  parseMaxRss,
  parseTimingLine,
  summarizeTiming,
  timeCommandFlag,
} from "./corpus-timing-core";
import { executablePath } from "./parse-agreement-core";
import { parseFileList } from "./records";
import type { GateLanguage } from "./result-diff";
import { CANDIDATE_BINARY as CANDIDATE_BASE } from "./target";

/**
 * Parses a corpus set with the candidate in one process per language and
 * records the parse times and the peak resident set size. Exits 1 when a file
 * takes longer than the limit.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

/** The candidate; Windows builds carry an `.exe` suffix the shared constant lacks. */
const CANDIDATE_BINARY = executablePath(CANDIDATE_BASE, process.platform);

const CORPUS_ROOT = join(REPO_ROOT, ".tmp/parser-gate/corpus");

const DEFAULT_OUT = join(REPO_ROOT, ".tmp/parser-gate/results");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

const TIME_COMMAND = "/usr/bin/time";

/** A trivial program that exists at this path on macOS and Linux. */
const PROBE_COMMAND = "/usr/bin/true";

type TimingArgs = {
  set: "development" | "holdout";
  languages: readonly GateLanguage[];
  out: string;
};

function parseArgs(argv: readonly string[]): TimingArgs {
  const [set, ...rest] = argv;
  if (set !== "development" && set !== "holdout") {
    throw new Error(`set must be "development" or "holdout", got ${JSON.stringify(set)}`);
  }
  let languages = LANGUAGES;
  let out = DEFAULT_OUT;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "swift" || arg === "dart") {
      languages = [arg];
    } else if (arg === "--out") {
      const value = rest[index + 1];
      if (value === undefined) {
        throw new Error("--out needs a directory");
      }
      out = resolve(value);
      index += 1;
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return { set, languages, out };
}

type Measured = { stdout: string; maxRssBytes: number | null; memoryNote: string | null };

/** Why peak memory cannot be measured here, or `null` when `/usr/bin/time` reports it. */
function memoryUnavailableReason(): string | null {
  const flag = timeCommandFlag(process.platform);
  if (flag === null) {
    return `no peak memory report for platform ${process.platform}`;
  }
  if (!existsSync(TIME_COMMAND)) {
    return `${TIME_COMMAND} not found`;
  }
  const probe = spawnSync(TIME_COMMAND, [flag, PROBE_COMMAND], { encoding: "utf8" });
  if (probe.status !== 0 || parseMaxRss(probe.stderr, process.platform) === null) {
    return `${TIME_COMMAND} ${flag} did not report a maximum resident set size: ${probe.stderr.trim().slice(0, 200)}`;
  }
  return null;
}

/** One candidate process over `input`, wrapped in `/usr/bin/time` unless `unavailable` says it cannot report. */
function runCandidate(language: GateLanguage, input: string, unavailable: string | null): Measured {
  const flag = timeCommandFlag(process.platform);
  const wrapped = unavailable === null && flag !== null;
  const run = spawnSync(
    wrapped ? TIME_COMMAND : CANDIDATE_BINARY,
    [...(wrapped ? [flag, CANDIDATE_BINARY] : []), "parse", language],
    { input, encoding: "utf8", maxBuffer: 1 << 29 },
  );
  if (run.status !== 0) {
    throw new Error(
      `parser-gate parse ${language} exited ${run.status ?? run.signal}: ${run.stderr.slice(0, 500)}`,
    );
  }
  if (!wrapped) {
    return { stdout: run.stdout, maxRssBytes: null, memoryNote: unavailable };
  }
  const maxRssBytes = parseMaxRss(run.stderr, process.platform);
  return {
    stdout: run.stdout,
    maxRssBytes,
    memoryNote:
      maxRssBytes === null ? `no maximum resident set size in the ${TIME_COMMAND} report` : null,
  };
}

function main(): number {
  const { set, languages, out } = parseArgs(process.argv.slice(2));
  if (!existsSync(CANDIDATE_BINARY)) {
    throw new Error(
      `candidate binary not found at ${CANDIDATE_BINARY}; run \`just build-parser-gate\``,
    );
  }
  const unavailable = memoryUnavailableReason();
  const rows: TimingRow[] = [];
  for (const language of languages) {
    const listing = join(CORPUS_ROOT, language, `${set}.files.jsonl`);
    if (!existsSync(listing)) {
      throw new Error(
        `${listing} not found; fetch the corpus with \`just parser-gate-fetch-corpus ${set}\``,
      );
    }
    const entries = parseFileList(readFileSync(listing, "utf8"));
    const relativePaths = new Map(
      entries.map((entry) => [entry.file, `${entry.repository}/${entry.path}`]),
    );
    const measured = runCandidate(
      language,
      `${entries.map((entry) => entry.file).join("\n")}\n`,
      unavailable,
    );
    const samples = measured.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => parseTimingLine(line))
      .map((sample) => ({ ...sample, path: relativePaths.get(sample.path) ?? sample.path }));
    if (samples.length !== entries.length) {
      throw new Error(`${language}: ${entries.length} files but ${samples.length} results`);
    }
    const stats = summarizeTiming(samples);
    mkdirSync(join(out, set), { recursive: true });
    writeFileSync(
      join(out, set, `${language}.timing.json`),
      `${JSON.stringify(
        {
          set,
          language,
          platform: process.platform,
          arch: process.arch,
          ...stats,
          maxRssBytes: measured.maxRssBytes,
          memoryNote: measured.memoryNote,
        },
        null,
        2,
      )}\n`,
    );
    if (measured.memoryNote !== null) {
      console.log(`${language}: memory is null: ${measured.memoryNote}`);
    }
    rows.push({ language, stats, maxRssBytes: measured.maxRssBytes });
  }
  console.log(formatTimingTable(rows));
  return rows.some((row) => row.stats.overLimit > 0) ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
