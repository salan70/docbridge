import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { LANGUAGE_SUFFIXES } from "../../src/config/code-language";
import { scanCodeFiles } from "../../src/scan/code/dispatch";
import {
  AGREEMENT_LANGUAGES,
  type AgreementLanguage,
  type AgreementRow,
  agreementFails,
  classify,
  formatAgreementTable,
  isExcludedDirectory,
  parseCandidateLine,
  scannedPathOf,
  selectSourceFiles,
  summarizeAgreement,
} from "./parse-agreement-core";
import { chunk } from "./records";
import { CANDIDATE_BINARY } from "./target";

/**
 * Checks, for the seven languages the shipped adapters already parse, that the
 * candidate accepts and rejects the same files. The shipped verdict is the
 * absence of a `code_parse_error` from the shipped adapter; the candidate's is
 * `parser-gate parse`. A file only the shipped adapter accepts fails the check.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

const CONFORMANCE_ROOT = join(REPO_ROOT, "test-fixtures/scanner-conformance");

const DEFAULT_OUT = join(REPO_ROOT, ".tmp/parser-gate/results");

const SHIPPED_BATCH_SIZE = 50;

const PARSE_ERROR_CODE = "code_parse_error";

/** The diagnostic codes that mean the shipped adapter could not scan at all. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "code_scanner_unavailable",
  "code_scanner_failed",
]);

/** One input: its identity, the file the candidate reads, and the path the shipped adapter is told. */
type Input = {
  language: AgreementLanguage;
  /** Repository-relative path, the row's identity. */
  path: string;
  /** Absolute path of the file the candidate reads. */
  file: string;
  scannedPath: string;
  content: string;
};

function parseArgs(argv: readonly string[]): { out: string } {
  let out = DEFAULT_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--out needs a directory");
      }
      out = resolve(value);
      index += 1;
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  return { out };
}

function walk(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!isExcludedDirectory(entry.name)) {
        walk(join(dir, entry.name), found);
      }
    } else if (entry.isFile()) {
      found.push(join(dir, entry.name));
    }
  }
}

function decodeUtf8(file: string): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
  } catch {
    return undefined;
  }
}

/** Every input of `language`, and the files skipped because they are not valid UTF-8. */
function collectInputs(
  language: AgreementLanguage,
  repoPaths: readonly string[],
  out: string,
): { inputs: Input[]; skipped: string[] } {
  const inputs: Input[] = [];
  const skipped: string[] = [];
  const add = (path: string, file: string): void => {
    const content = decodeUtf8(file);
    if (content === undefined) {
      skipped.push(path);
      return;
    }
    inputs.push({ language, path, file, scannedPath: scannedPathOf(path, language), content });
  };
  const copies = join(out, "inputs", language);
  if (existsSync(CONFORMANCE_ROOT)) {
    for (const entry of readdirSync(CONFORMANCE_ROOT, { withFileTypes: true })) {
      const source = join(CONFORMANCE_ROOT, entry.name, language, "input.txt");
      if (entry.isDirectory() && existsSync(source)) {
        const suffix = LANGUAGE_SUFFIXES[language][0] ?? "";
        mkdirSync(copies, { recursive: true });
        const copy = join(copies, `${entry.name}${suffix}`);
        copyFileSync(source, copy);
        add(relative(REPO_ROOT, source), copy);
      }
    }
  }
  for (const path of selectSourceFiles(repoPaths, language)) {
    add(path, join(REPO_ROOT, path));
  }
  return { inputs, skipped };
}

/** The scanned paths the shipped adapter rejects, or the reason it could not scan. */
async function shippedRejections(
  language: AgreementLanguage,
  inputs: readonly Input[],
): Promise<{ rejected: Set<string> } | { unavailable: string }> {
  const rejected = new Set<string>();
  for (const batch of chunk(inputs, SHIPPED_BATCH_SIZE)) {
    const contents = new Map(batch.map((input) => [input.scannedPath, input.content]));
    const { codeFiles, diagnostics } = await scanCodeFiles(
      REPO_ROOT,
      batch.map((input) => ({ language, relPath: input.scannedPath })),
      { [language]: { patterns: batch.map((input) => input.scannedPath) } },
      (relPath) => ({ ok: true, content: contents.get(relPath) ?? "" }),
    ).promise;
    const all = [...diagnostics, ...codeFiles.flatMap((file) => file.diagnostics)];
    const unavailable = all.find((diagnostic) => UNAVAILABLE_CODES.has(diagnostic.code));
    if (unavailable !== undefined) {
      return { unavailable: `${unavailable.code}: ${unavailable.message}` };
    }
    for (const file of codeFiles) {
      if (file.diagnostics.some((diagnostic) => diagnostic.code === PARSE_ERROR_CODE)) {
        rejected.add(file.filePath);
      }
    }
  }
  return { rejected };
}

/** The set of paths the candidate accepts. Throws when it cannot give a verdict for each. */
function candidateAcceptances(
  language: AgreementLanguage,
  inputs: readonly Input[],
): Map<string, boolean> {
  const run = spawnSync(CANDIDATE_BINARY, ["parse", language], {
    input: `${inputs.map((input) => input.file).join("\n")}\n`,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (run.status !== 0) {
    throw new Error(
      `parser-gate parse ${language} exited ${run.status ?? run.signal}: ${run.stderr.slice(0, 500)}`,
    );
  }
  const verdicts = new Map<string, boolean>();
  for (const line of run.stdout.split("\n").filter((text) => text !== "")) {
    const verdict = parseCandidateLine(line);
    if ("unreadable" in verdict) {
      throw new Error(`candidate could not read ${verdict.path}`);
    }
    verdicts.set(verdict.path, verdict.accepted);
  }
  return verdicts;
}

async function main(): Promise<number> {
  const { out } = parseArgs(process.argv.slice(2));
  if (!existsSync(CANDIDATE_BINARY)) {
    throw new Error(
      `candidate binary not found at ${CANDIDATE_BINARY}; run \`just build-parser-gate\``,
    );
  }
  const repoPaths: string[] = [];
  walk(REPO_ROOT, repoPaths);
  const relativePaths = repoPaths.map((path) => relative(REPO_ROOT, path));
  const rows: AgreementRow[] = [];
  const unavailable: Record<string, string> = {};
  const skipped: string[] = [];
  for (const language of AGREEMENT_LANGUAGES) {
    const collected = collectInputs(language, relativePaths, out);
    skipped.push(...collected.skipped);
    const shipped = await shippedRejections(language, collected.inputs);
    if ("unavailable" in shipped) {
      unavailable[language] = shipped.unavailable;
      continue;
    }
    const candidate = candidateAcceptances(language, collected.inputs);
    for (const input of collected.inputs) {
      const accepted = candidate.get(input.file);
      if (accepted === undefined) {
        throw new Error(`candidate gave no verdict for ${input.file}`);
      }
      rows.push({
        language,
        path: input.path,
        outcome: classify(shipped.rejected.has(input.scannedPath), accepted),
      });
    }
  }
  const summary = summarizeAgreement(rows);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "parse-agreement.json"),
    `${JSON.stringify({ summary, unavailable, skipped, rows }, null, 2)}\n`,
  );
  console.log(formatAgreementTable(summary));
  for (const [language, reason] of Object.entries(unavailable)) {
    console.log(`UNAVAILABLE ${language}: ${reason}`);
  }
  for (const path of skipped) {
    console.log(`skipped (not UTF-8) ${path}`);
  }
  for (const path of summary.shippedOnly) {
    console.log(`SHIPPED ONLY   ${path}`);
  }
  for (const path of summary.candidateOnly) {
    console.log(`candidate only ${path}`);
  }
  return agreementFails(summary) || Object.keys(unavailable).length > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
