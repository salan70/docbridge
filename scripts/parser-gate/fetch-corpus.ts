import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  type CorpusEntry,
  type CorpusSet,
  type Language,
  corpusEntries,
  isCountedPath,
  sampleFiles,
} from "./corpus";

/**
 * Fetches one set of the parser gate corpus at the pinned commits. Each
 * repository is a shallow, blobless clone under `.tmp/parser-gate/corpus/`.
 * Only the sampled files are checked out, and the files that are not valid
 * UTF-8 are dropped and recorded. The final holdout needs `--confirm-holdout`.
 */
const CORPUS_ROOT = resolve(import.meta.dir, "../../.tmp/parser-gate/corpus");

const SETS: readonly CorpusSet[] = ["development", "holdout"];

const LANGUAGES: readonly Language[] = ["swift", "dart"];

const KNOWN_FLAGS = new Set(["--dry-run", "--confirm-holdout"]);

const USAGE =
  "usage: fetch-corpus.ts <development|holdout> [swift|dart] [--dry-run] [--confirm-holdout]";

const MAX_GIT_OUTPUT = 512 * 1024 * 1024;

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type Options = {
  set: CorpusSet;
  languages: readonly Language[];
  dryRun: boolean;
  confirmHoldout: boolean;
};

type FileRecord = { repository: string; path: string; file: string };

type DroppedRecord = { repository: string; path: string; reason: "invalid-utf8" };

type RepositoryState = { commit: string; sample: string[]; dropped: string[] };

type RepositoryResult = {
  kept: FileRecord[];
  dropped: DroppedRecord[];
  cached: boolean;
};

function parseArgs(argv: readonly string[]): Options {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`unknown option ${flag}\n${USAGE}`);
    }
  }
  const [setName, languageName, ...rest] = argv.filter((arg) => !arg.startsWith("--"));
  const set = SETS.find((candidate) => candidate === setName);
  if (set === undefined || rest.length > 0) {
    throw new Error(USAGE);
  }
  const languages =
    languageName === undefined
      ? LANGUAGES
      : LANGUAGES.filter((candidate) => candidate === languageName);
  if (languages.length === 0) {
    throw new Error(`unknown language ${languageName}\n${USAGE}`);
  }
  return {
    set,
    languages,
    dryRun: flags.has("--dry-run"),
    confirmHoldout: flags.has("--confirm-holdout"),
  };
}

function repositoryDir(language: Language, repository: string): string {
  return join(CORPUS_ROOT, language, repository.replace("/", "__"));
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT });
}

function hasCommit(dir: string, commit: string): boolean {
  if (!existsSync(join(dir, ".git"))) {
    return false;
  }
  try {
    git(dir, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function fetchCommit(dir: string, repository: string, commit: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet"]);
  git(dir, [
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "--filter=blob:none",
    `https://github.com/${repository}.git`,
    commit,
  ]);
}

/**
 * Lists the counted files at the pinned commit. A regular file is a blob that
 * is not a symbolic link (mode 120000).
 */
function countedPaths(language: Language, dir: string, entry: CorpusEntry): string[] {
  const output = git(dir, ["ls-tree", "-r", "-z", "--full-tree", entry.commit]);
  const paths = output
    .split("\0")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const tab = line.indexOf("\t");
      const [mode = "", type = ""] = line.slice(0, tab).split(" ");
      const path = line.slice(tab + 1);
      return type === "blob" && mode !== "120000" && isCountedPath(language, path) ? [path] : [];
    });
  if (paths.length !== entry.counted) {
    throw new Error(
      `${entry.repository}: ${paths.length} counted files at ${entry.commit}, the plan says ${entry.counted}`,
    );
  }
  return paths;
}

function readState(dir: string): RepositoryState | undefined {
  const file = join(dir, ".git", "parser-gate-state.json");
  if (!existsSync(file)) {
    return undefined;
  }
  return JSON.parse(readFileSync(file, "utf8")) as RepositoryState;
}

function writeState(dir: string, state: RepositoryState): void {
  writeFileSync(join(dir, ".git", "parser-gate-state.json"), JSON.stringify(state));
}

/** The blob object IDs of `paths` at the pinned commit. */
function blobIds(dir: string, commit: string, paths: readonly string[]): string[] {
  const wanted = new Set(paths);
  const ids = git(dir, ["ls-tree", "-r", "-z", "--full-tree", commit])
    .split("\0")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const tab = line.indexOf("\t");
      const [, , id = ""] = line.slice(0, tab).split(" ");
      return wanted.has(line.slice(tab + 1)) ? [id] : [];
    });
  return [...new Set(ids)];
}

/**
 * Fetches the sampled blobs in one request. A pathspec checkout in a blobless
 * clone would otherwise fetch them one request at a time.
 */
function fetchBlobs(dir: string, repository: string, ids: readonly string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "fetch.negotiationAlgorithm=noop",
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "--filter=blob:none",
      "--stdin",
      `https://github.com/${repository}.git`,
    ],
    { cwd: dir, input: `${ids.join("\n")}\n`, maxBuffer: MAX_GIT_OUTPUT },
  );
}

function checkoutSample(
  dir: string,
  repository: string,
  commit: string,
  sample: readonly string[],
): void {
  fetchBlobs(dir, repository, blobIds(dir, commit, sample));
  const pathspecFile = join(dir, ".git", "parser-gate-pathspec.nul");
  writeFileSync(pathspecFile, sample.join("\0"));
  git(dir, [
    "--literal-pathspecs",
    "checkout",
    commit,
    `--pathspec-from-file=${pathspecFile}`,
    "--pathspec-file-nul",
  ]);
}

function isUtf8(file: string): boolean {
  try {
    UTF8_DECODER.decode(readFileSync(file));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches and samples one repository. A repository whose commit and sampled
 * file list match the recorded state is not fetched or checked out again.
 */
function fetchRepository(language: Language, entry: CorpusEntry): RepositoryResult {
  const dir = repositoryDir(language, entry.repository);
  if (!hasCommit(dir, entry.commit)) {
    fetchCommit(dir, entry.repository, entry.commit);
  }
  const sample = sampleFiles(countedPaths(language, dir, entry), entry.used);

  const state = readState(dir);
  let cached = false;
  let dropped: string[];
  if (
    state !== undefined &&
    state.commit === entry.commit &&
    JSON.stringify(state.sample) === JSON.stringify(sample) &&
    sample.every((path) => state.dropped.includes(path) || existsSync(join(dir, path)))
  ) {
    dropped = state.dropped;
    cached = true;
  } else {
    if (sample.length > 0) {
      checkoutSample(dir, entry.repository, entry.commit, sample);
    }
    dropped = sample.filter((path) => !isUtf8(join(dir, path)));
    writeState(dir, { commit: entry.commit, sample, dropped });
  }

  const kept = sample.filter((path) => !dropped.includes(path));
  return {
    kept: kept.map((path) => ({ repository: entry.repository, path, file: join(dir, path) })),
    dropped: dropped.map((path) => ({
      repository: entry.repository,
      path,
      reason: "invalid-utf8",
    })),
    cached,
  };
}

function jsonLines(records: readonly object[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

function fetchSet(language: Language, set: CorpusSet): void {
  const outDir = join(CORPUS_ROOT, language);
  mkdirSync(outDir, { recursive: true });
  const kept: FileRecord[] = [];
  const dropped: DroppedRecord[] = [];
  for (const entry of corpusEntries(language, set)) {
    const result = fetchRepository(language, entry);
    kept.push(...result.kept);
    dropped.push(...result.dropped);
    const note = result.cached ? " (cached)" : "";
    console.log(`${language} ${set} ${entry.repository}: ${result.kept.length} files${note}`);
  }
  writeFileSync(join(outDir, `${set}.files.jsonl`), jsonLines(kept));
  writeFileSync(join(outDir, `${set}.dropped.jsonl`), jsonLines(dropped));
  console.log(`${language} ${set} total: ${kept.length} files, ${dropped.length} dropped`);
}

function printPlan(language: Language, set: CorpusSet): void {
  const entries = corpusEntries(language, set);
  for (const entry of entries) {
    console.log(
      `${language} ${set} ${entry.repository} ${entry.commit} used ${entry.used} of ${entry.counted}`,
    );
  }
  const total = entries.reduce((sum, entry) => sum + entry.used, 0);
  console.log(`${language} ${set} total: ${total} files`);
}

function main(argv: readonly string[]): void {
  const options = parseArgs(argv);
  if (options.set === "holdout" && !options.confirmHoldout) {
    throw new Error(
      "the final holdout is fetched only after PR 2 merges; pass --confirm-holdout after that",
    );
  }
  for (const language of options.languages) {
    if (options.dryRun) {
      printPlan(language, options.set);
    } else {
      fetchSet(language, options.set);
    }
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
