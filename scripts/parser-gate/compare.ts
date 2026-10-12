import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokeScannerWorker } from "../../src/scan/code/worker/scanner-worker";
import type { ScannerWorkerRequest } from "../../src/scan/code/worker/scanner-worker";
import {
  CONFIGURATIONS,
  type GateRecord,
  type InjectedCheck,
  type RecordMeta,
  type ScannedFile,
  type TargetResult,
  alignResponse,
  buildRecord,
  checkInjection,
  chunk,
  formatTable,
  parseConstructs,
  parseFileList,
  requestFilePath,
  statusOf,
  summarize,
  withConstruct,
} from "./records";
import type { GateLanguage, GateTarget } from "./result-diff";
import { CANDIDATE_BINARY, resolveWorkerCommand } from "./target";
import { injectAnnotation, malformedVariants, selectMalformedFiles, sha256Hex } from "./variants";

/**
 * Sends every corpus file, its injected variant and its malformed variants to
 * the shipped worker and to the candidate, and writes one record per file,
 * variant and configuration with a summary. The summary holds the inputs of
 * the plan's decision rule; it does not decide the gate.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

const BATCH_SIZE = 40;

const CONCURRENCY = 4;

const DEFAULT_CONFIGURATION = "default";

type CompareArgs = {
  set: "development" | "holdout";
  languages: readonly GateLanguage[];
  limit: number | undefined;
  corpus: string;
  out: string;
};

function parseArgs(argv: readonly string[]): CompareArgs {
  const [set, ...rest] = argv;
  if (set !== "development" && set !== "holdout") {
    throw new Error(`set must be "development" or "holdout", got ${JSON.stringify(set)}`);
  }
  const args: CompareArgs = {
    set,
    languages: LANGUAGES,
    limit: undefined,
    corpus: join(REPO_ROOT, ".tmp/parser-gate/corpus"),
    out: join(REPO_ROOT, ".tmp/parser-gate/results"),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "swift" || arg === "dart") {
      args.languages = [arg];
    } else if (arg === "--limit" || arg === "--corpus" || arg === "--out") {
      const value = rest[index + 1];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      if (arg === "--limit") {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error(`--limit needs a positive integer, got ${JSON.stringify(value)}`);
        }
        args.limit = limit;
      } else {
        args[arg === "--corpus" ? "corpus" : "out"] = resolve(value);
      }
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return args;
}

type Item = {
  repository: string;
  path: string;
  filePath: string;
  /** The corpus file the content was read from. */
  file: string;
  content: string;
  contentSha256: string;
};

type Pair = { shipped: TargetResult; candidate: TargetResult };

type Commands = Record<GateTarget, string[]>;

function request(
  language: GateLanguage,
  visibility: readonly string[],
  files: readonly { filePath: string; content: string }[],
  id: string,
): ScannerWorkerRequest {
  return {
    schemaVersion: 1,
    requestId: id,
    language,
    projectRoot: "/",
    files: files.map(({ filePath, content }) => ({ filePath, content })),
    options: { visibility: [...visibility] },
  };
}

/** The scans of the requested files in order, or `undefined` when the request failed. */
async function sendRequest(
  command: string[],
  message: ScannerWorkerRequest,
): Promise<ScannedFile[] | undefined> {
  const result = await invokeScannerWorker(message, command).promise;
  if (!result.ok) {
    return undefined;
  }
  return alignResponse(
    message.files.map((file) => file.filePath),
    result.codeFiles,
  );
}

/** One batch for one target; a failed batch is retried file by file. */
async function sendBatch(
  command: string[],
  language: GateLanguage,
  visibility: readonly string[],
  files: readonly { filePath: string; content: string }[],
  id: string,
): Promise<TargetResult[]> {
  const whole = await sendRequest(command, request(language, visibility, files, id));
  if (whole !== undefined) {
    return whole;
  }
  const results: TargetResult[] = [];
  for (const [index, file] of files.entries()) {
    const single = await sendRequest(
      command,
      request(language, visibility, [file], `${id}-${index}`),
    );
    results.push(single?.[0] ?? "failed");
  }
  return results;
}

/** Runs the tasks with at most `limit` in flight, keeping the result order. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task !== undefined) {
        results[index] = await task();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Sends one configuration's request files to both targets, 40 per request. */
async function measure(
  commands: Commands,
  language: GateLanguage,
  configuration: string,
  files: readonly { filePath: string; content: string }[],
  label: string,
): Promise<Pair[]> {
  const visibility = CONFIGURATIONS[language][configuration] ?? [];
  const batches = chunk(files, BATCH_SIZE);
  const tasks = batches.map((batch, index) => async (): Promise<Pair[]> => {
    const id = `parser-gate-${language}-${label}-${configuration}-${index}`;
    const [shipped, candidate] = await Promise.all([
      sendBatch(commands.shipped, language, visibility, batch, id),
      sendBatch(commands.candidate, language, visibility, batch, id),
    ]);
    return batch.map((_, at) => ({
      shipped: shipped[at] ?? "failed",
      candidate: candidate[at] ?? "failed",
    }));
  });
  const pairs = (await pool(tasks, CONCURRENCY)).flat();
  console.error(`${language} ${label} ${configuration}: ${files.length} files`);
  return pairs;
}

function readItems(args: CompareArgs, language: GateLanguage): Item[] {
  const listPath = join(args.corpus, language, `${args.set}.files.jsonl`);
  let entries = parseFileList(readFileSync(listPath, "utf8"));
  if (args.limit !== undefined) {
    entries = entries.slice(0, args.limit);
  }
  const items: Item[] = [];
  const unreadable: string[] = [];
  for (const entry of entries) {
    let content: string;
    try {
      content = readFileSync(entry.file, "utf8");
    } catch (error) {
      unreadable.push(`${entry.file}: ${String(error)}`);
      continue;
    }
    items.push({
      repository: entry.repository,
      path: entry.path,
      filePath: requestFilePath(entry.repository, entry.path),
      file: entry.file,
      content,
      contentSha256: sha256Hex(content),
    });
  }
  if (unreadable.length > 0) {
    throw new Error(
      `${language}: ${unreadable.length} listed files are unreadable:\n${unreadable.join("\n")}`,
    );
  }
  return items;
}

/** The construct the candidate's `parse` rejects each file at, keyed by file. */
function rejectedConstructs(
  language: GateLanguage,
  files: readonly string[],
): Map<string, string | null> {
  if (files.length === 0) {
    return new Map();
  }
  const run = spawnSync(CANDIDATE_BINARY, ["parse", language], {
    input: `${files.join("\n")}\n`,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (run.status !== 0) {
    throw new Error(
      `parser-gate parse ${language} exited ${run.status ?? run.signal}: ${run.stderr.slice(0, 500)}`,
    );
  }
  return parseConstructs(run.stdout);
}

function metaOf(
  args: CompareArgs,
  language: GateLanguage,
  item: Item,
  variant: string,
  configuration: string,
): RecordMeta {
  return {
    language,
    set: args.set,
    repository: item.repository,
    path: item.path,
    contentSha256: item.contentSha256,
    variant,
    configuration,
  };
}

/** Writes the language's results; returns the number of files the candidate run failed on. */
async function runLanguage(
  args: CompareArgs,
  language: GateLanguage,
  items: readonly Item[],
): Promise<number> {
  const commands: Commands = {
    shipped: resolveWorkerCommand("shipped", language),
    candidate: resolveWorkerCommand("candidate", language),
  };
  const outDir = join(args.out, args.set);
  mkdirSync(outDir, { recursive: true });
  const recordsPath = join(outDir, `${language}.records.jsonl`);
  writeFileSync(recordsPath, "");
  const records: GateRecord[] = [];
  const emit = (rows: readonly GateRecord[]): void => {
    records.push(...rows);
    appendFileSync(recordsPath, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  };

  const configurations = Object.keys(CONFIGURATIONS[language]);

  // unmodified
  const unmodified = new Map<string, Pair[]>();
  for (const configuration of configurations) {
    const pairs = await measure(commands, language, configuration, items, "unmodified");
    unmodified.set(configuration, pairs);
  }
  const rejectedFiles = [
    ...new Set(
      items
        .filter((_, index) =>
          [...unmodified.values()].some((pairs) => {
            const pair = pairs[index];
            return pair !== undefined && statusOf(pair.candidate) === "reject";
          }),
        )
        .map((item) => item.file),
    ),
  ];
  const constructs = rejectedConstructs(language, rejectedFiles);
  for (const configuration of configurations) {
    const pairs = unmodified.get(configuration) ?? [];
    emit(
      items.map((item, index) => {
        const pair = pairs[index];
        return withConstruct(
          buildRecord(
            metaOf(args, language, item, "unmodified", configuration),
            pair?.shipped ?? "failed",
            pair?.candidate ?? "failed",
          ),
          constructs.get(item.file),
        );
      }),
    );
  }

  // injected: built from the shipped worker's default-configuration result
  const defaults = unmodified.get(DEFAULT_CONFIGURATION) ?? [];
  const injections = items.flatMap((item, index) => {
    const shipped = defaults[index]?.shipped;
    if (shipped === undefined || shipped === "failed" || statusOf(shipped) !== "accept") {
      return [];
    }
    const injection = injectAnnotation(item.content, shipped);
    return injection === undefined ? [] : [{ item, index, injection }];
  });
  for (const configuration of configurations) {
    const pairs = await measure(
      commands,
      language,
      configuration,
      injections.map(({ item, injection }) => ({
        filePath: item.filePath,
        content: injection.content,
      })),
      "injected",
    );
    const base = unmodified.get(configuration) ?? [];
    emit(
      injections.map(({ item, index, injection }, at) => {
        const pair = pairs[at];
        const baseline = base[index];
        const check: InjectedCheck = {
          symbol: injection.canonicalId,
          shippedOk: checkInjection(
            baseline?.shipped ?? "failed",
            pair?.shipped ?? "failed",
            injection.expected,
          ),
          candidateOk: checkInjection(
            baseline?.candidate ?? "failed",
            pair?.candidate ?? "failed",
            injection.expected,
          ),
        };
        return buildRecord(
          metaOf(args, language, item, "injected", configuration),
          pair?.shipped ?? "failed",
          pair?.candidate ?? "failed",
          check,
        );
      }),
    );
  }

  // malformed
  const selected = selectMalformedFiles(items);
  const mutations = selected.flatMap((item) =>
    malformedVariants(item.content, `${item.repository}/${item.path}`).map((variant) => ({
      item,
      name: `malformed:${variant.name}`,
      content: variant.content,
    })),
  );
  for (const name of new Set(mutations.map((mutation) => mutation.name))) {
    const group = mutations.filter((mutation) => mutation.name === name);
    for (const configuration of configurations) {
      const pairs = await measure(
        commands,
        language,
        configuration,
        group.map(({ item, content }) => ({ filePath: item.filePath, content })),
        name.replace(":", "-"),
      );
      emit(
        group.map(({ item }, at) =>
          buildRecord(
            metaOf(args, language, item, name, configuration),
            pairs[at]?.shipped ?? "failed",
            pairs[at]?.candidate ?? "failed",
          ),
        ),
      );
    }
  }

  const summary = { language, set: args.set, ...summarize(records) };
  writeFileSync(join(outDir, `${language}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${language} ${args.set}`);
  console.log(formatTable(summary));
  console.log(`rule: ${JSON.stringify(summary.rule)}`);
  return summary.rule.candidateFailed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Read every list first so an unreadable file stops the run before any measurement.
  const itemsByLanguage = args.languages.map((language) => readItems(args, language));
  for (const [index, language] of args.languages.entries()) {
    const failed = await runLanguage(args, language, itemsByLanguage[index] ?? []);
    if (failed > 0) {
      console.error(
        `${language}: the candidate run failed on ${failed} files; the measurement is invalid`,
      );
      process.exitCode = 1;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
