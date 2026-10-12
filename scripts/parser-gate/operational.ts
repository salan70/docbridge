import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  type CancelEntry,
  type CancelSample,
  type InputEntry,
  OPERATIONAL_LANGUAGES,
  type OperationalLanguage,
  PLANNED_SIZES,
  type RunResult,
  adversarialInputs,
  cancelVerdict,
  classifyRun,
  formatOperationalTable,
  inputFileName,
  operationalFails,
} from "./operational-core";
import { CANDIDATE_BINARY } from "./target";

/**
 * Runs the candidate on adversarial inputs, one process per file with a wall
 * clock limit, and checks that Swift and Dart parses cancel promptly.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

const ADVERSARIAL_ROOT = join(REPO_ROOT, ".tmp/parser-gate/adversarial");

const DEFAULT_OUT = join(REPO_ROOT, ".tmp/parser-gate/results");

const TIMEOUT_MS = 10_000;

/** For the rerun that records how long an input over the bound takes. */
const UNBOUNDED_TIMEOUT_MS = 120_000;

const RETRY_STACK_MB = 1024;

const CANCEL_RUNS = 20;

const CANCEL_LANGUAGES: readonly OperationalLanguage[] = ["swift", "dart"];

const CANCEL_INPUT = "repeated-declarations";

/** Generous: a cancel run parses a 50 MB file and must report within seconds. */
const CANCEL_TIMEOUT_MS = 60_000;

type OperationalArgs = { out: string; only: OperationalLanguage | undefined };

function parseArgs(argv: readonly string[]): OperationalArgs {
  let out = DEFAULT_OUT;
  let only: OperationalLanguage | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--out" || arg === "--only") {
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      if (arg === "--out") {
        out = resolve(value);
      } else {
        const language = OPERATIONAL_LANGUAGES.find((candidate) => candidate === value);
        if (language === undefined) {
          throw new Error(`--only needs one of ${OPERATIONAL_LANGUAGES.join(", ")}`);
        }
        only = language;
      }
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return { out, only };
}

/** One `parser-gate parse` process on one file. */
function runParse(
  language: OperationalLanguage,
  file: string,
  limits: { stackMb?: number; timeoutMs: number },
): { result: RunResult; micros: number } {
  const { stackMb, timeoutMs } = limits;
  const args = ["parse", language, ...(stackMb === undefined ? [] : ["--stack-mb", `${stackMb}`])];
  const run = spawnSync(CANDIDATE_BINARY, args, {
    input: `${file}\n`,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 1 << 24,
  });
  if (run.status === 2) {
    throw new Error(`parser-gate ${args.join(" ")} rejected its arguments: ${run.stderr}`);
  }
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  let accepted: boolean | undefined;
  let micros = 0;
  const line = run.stdout?.split("\n").find((text) => text !== "");
  if (line !== undefined) {
    const value: unknown = JSON.parse(line);
    if (typeof value === "object" && value !== null) {
      if ("accepted" in value && typeof value.accepted === "boolean") {
        accepted = value.accepted;
      }
      if ("micros" in value && typeof value.micros === "number") {
        micros = value.micros;
      }
    }
  }
  const result = classifyRun({
    status: run.status,
    signal: run.signal,
    timedOut,
    accepted,
  });
  return { result, micros };
}

function runCancel(language: OperationalLanguage, file: string): CancelSample {
  const run = spawnSync(CANDIDATE_BINARY, ["cancel", language, file], {
    encoding: "utf8",
    timeout: CANCEL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const value: unknown = run.status === 0 ? JSON.parse(run.stdout.trim()) : undefined;
  if (
    typeof value === "object" &&
    value !== null &&
    "cancelled" in value &&
    typeof value.cancelled === "boolean" &&
    "latencyMicros" in value &&
    typeof value.latencyMicros === "number"
  ) {
    return { cancelled: value.cancelled, latencyMicros: value.latencyMicros };
  }
  // A cancel process that died or timed out has not cancelled in time.
  return { cancelled: false, latencyMicros: Number.MAX_SAFE_INTEGER };
}

function main(): number {
  const { out, only } = parseArgs(process.argv.slice(2));
  if (!existsSync(CANDIDATE_BINARY)) {
    throw new Error(
      `candidate binary not found at ${CANDIDATE_BINARY}; run \`just build-parser-gate\``,
    );
  }
  const languages = only === undefined ? OPERATIONAL_LANGUAGES : [only];
  const entries: InputEntry[] = [];
  const cancels: CancelEntry[] = [];
  const sizes: Record<string, number> = {};
  for (const language of languages) {
    const dir = join(ADVERSARIAL_ROOT, language);
    mkdirSync(dir, { recursive: true });
    for (const input of adversarialInputs(language, PLANNED_SIZES)) {
      const file = join(dir, inputFileName(language, input.name));
      writeFileSync(file, input.generate());
      sizes[`${language}/${input.name}`] = statSync(file).size;
      const first = runParse(language, file, { timeoutMs: TIMEOUT_MS });
      const retry =
        first.result === "crash"
          ? runParse(language, file, { stackMb: RETRY_STACK_MB, timeoutMs: TIMEOUT_MS })
          : undefined;
      const unbounded =
        first.result === "timeout"
          ? runParse(language, file, { timeoutMs: UNBOUNDED_TIMEOUT_MS })
          : undefined;
      const entry: InputEntry = {
        language,
        name: input.name,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...first,
        ...(retry === undefined ? {} : { retry }),
        ...(unbounded === undefined ? {} : { unbounded }),
      };
      entries.push(entry);
      console.error(`${language}/${input.name}: ${entry.result}`);
      if (input.name === CANCEL_INPUT && CANCEL_LANGUAGES.includes(language)) {
        const samples = Array.from({ length: CANCEL_RUNS }, () => runCancel(language, file));
        cancels.push({ language, ...cancelVerdict(samples) });
        console.error(`${language}/cancel: ${cancels.at(-1)?.cancelled}/${CANCEL_RUNS}`);
      }
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "operational.json"),
    `${JSON.stringify({ entries, cancels, sizes }, null, 2)}\n`,
  );
  console.log(formatOperationalTable(entries, cancels));
  for (const entry of entries) {
    if (entry.note !== undefined) {
      console.log(`note ${entry.language}/${entry.name}: ${entry.note}`);
    }
  }
  return operationalFails(entries, cancels) ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
