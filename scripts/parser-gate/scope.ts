import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokeScannerWorker } from "../../src/scan/code/worker/scanner-worker";
import type { ScannerWorkerRequest } from "../../src/scan/code/worker/scanner-worker";
import {
  CONFIGURATIONS,
  type GateRecord,
  alignResponse,
  chunk,
  parseFileList,
  requestFilePath,
} from "./records";
import type { GateLanguage } from "./result-diff";
import {
  type FileScope,
  formatScopeTable,
  reportOf,
  scopeFile,
  selectRejected,
} from "./scope-core";
import type { ScopeScan } from "./scope-core";
import { resolveDeclarationScopeCommand, resolveWorkerCommand } from "./target";

/**
 * Takes the files the candidate rejects as a whole although the shipped worker
 * accepts them, scans them again with the candidate in declaration scope, and
 * scores how closely its symbols and links match the shipped worker's. The
 * scores are reference values, not part of the decision rule.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

const LANGUAGES: readonly GateLanguage[] = ["swift", "dart"];

const BATCH_SIZE = 40;

type ScopeArgs = {
  set: "development" | "holdout";
  languages: readonly GateLanguage[];
  out: string;
};

function parseArgs(argv: readonly string[]): ScopeArgs {
  const [set, ...rest] = argv;
  if (set !== "development" && set !== "holdout") {
    throw new Error(`set must be "development" or "holdout", got ${JSON.stringify(set)}`);
  }
  const args: ScopeArgs = {
    set,
    languages: LANGUAGES,
    out: join(REPO_ROOT, ".tmp/parser-gate/results"),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "swift" || arg === "dart") {
      args.languages = [arg];
    } else if (arg === "--out") {
      const value = rest[index + 1];
      if (value === undefined) {
        throw new Error("--out needs a value");
      }
      index += 1;
      args.out = resolve(value);
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return args;
}

function readRecords(path: string): GateRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GateRecord);
}

type Target = { repository: string; path: string; filePath: string; content: string };

/** The scans of the files in order. Throws when the request fails. */
async function scanAll(
  command: string[],
  language: GateLanguage,
  visibility: readonly string[],
  targets: readonly Target[],
  label: string,
): Promise<ScopeScan[]> {
  const scans: ScopeScan[] = [];
  for (const [index, batch] of chunk(targets, BATCH_SIZE).entries()) {
    const message: ScannerWorkerRequest = {
      schemaVersion: 1,
      requestId: `parser-gate-scope-${language}-${label}-${index}`,
      language,
      projectRoot: "/",
      files: batch.map(({ filePath, content }) => ({ filePath, content })),
      options: { visibility: [...visibility] },
    };
    const result = await invokeScannerWorker(message, command).promise;
    if (!result.ok) {
      throw new Error(`${label} ${language} scan failed: ${JSON.stringify(result).slice(0, 500)}`);
    }
    const aligned = alignResponse(
      batch.map((target) => target.filePath),
      result.codeFiles,
    );
    if (aligned === undefined) {
      throw new Error(`${label} ${language} scan did not answer every requested file`);
    }
    scans.push(...aligned);
  }
  return scans;
}

async function runLanguage(args: ScopeArgs, language: GateLanguage): Promise<void> {
  const outDir = join(args.out, args.set);
  const rows = selectRejected(readRecords(join(outDir, `${language}.records.jsonl`)));
  if (rows.length === 0) {
    console.log(`${language} ${args.set}: no files`);
    return;
  }
  const listPath = join(REPO_ROOT, ".tmp/parser-gate/corpus", language, `${args.set}.files.jsonl`);
  const fileOf = new Map<string, string>();
  for (const entry of parseFileList(readFileSync(listPath, "utf8"))) {
    fileOf.set(requestFilePath(entry.repository, entry.path), entry.file);
  }
  const shippedCommand = resolveWorkerCommand("shipped", language);
  const candidateCommand = resolveDeclarationScopeCommand(language);

  const scopes: FileScope[] = [];
  for (const configuration of Object.keys(CONFIGURATIONS[language])) {
    const targets = rows
      .filter((row) => row.configuration === configuration)
      .map((row): Target => {
        const filePath = requestFilePath(row.repository, row.path);
        const file = fileOf.get(filePath);
        if (file === undefined) {
          throw new Error(`${filePath} is not in ${listPath}`);
        }
        return {
          repository: row.repository,
          path: row.path,
          filePath,
          content: readFileSync(file, "utf8"),
        };
      });
    if (targets.length === 0) {
      continue;
    }
    const visibility = CONFIGURATIONS[language][configuration] ?? [];
    const [shipped, candidate] = await Promise.all([
      scanAll(shippedCommand, language, visibility, targets, `shipped-${configuration}`),
      scanAll(candidateCommand, language, visibility, targets, `candidate-${configuration}`),
    ]);
    for (const [index, target] of targets.entries()) {
      const shippedScan = shipped[index];
      const candidateScan = candidate[index];
      if (shippedScan === undefined || candidateScan === undefined) {
        throw new Error(`no scan for ${target.filePath}`);
      }
      scopes.push(
        scopeFile({
          repository: target.repository,
          path: target.path,
          configuration,
          filePath: target.filePath,
          shipped: shippedScan,
          candidate: candidateScan,
        }),
      );
    }
  }

  const report = reportOf(language, args.set, scopes);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${language}.scope.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${language} ${args.set}`);
  console.log(formatScopeTable(report));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const language of args.languages) {
    await runLanguage(args, language);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
