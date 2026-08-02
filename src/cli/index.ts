#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import pkg from "../../package.json";
import { CONFIG_FILE_NAME } from "../core/config";
import { context as runContextCore, formatContextResult } from "../core/context";
import { formatDiagnostic, formatSummary } from "../core/diagnostics";
import { formatGraphResult, graph as runGraphCore } from "../core/graph-output";
import {
  collectGateViolations,
  formatGateResult,
  formatRelatedResult,
  normalizeChangedPaths,
  related as runRelatedCore,
} from "../core/related";
import { check as runChecker } from "../core/resolver";
import { runLspServer } from "../lsp/server";
import { parseDocsCommand, runDocs } from "./docs";
import {
  CliError,
  commandHelpGuidance,
  configRepairGuidance,
  configSetupGuidance,
  DiagnosticOutputError,
  formatCliError,
  includeContentGuidance,
  missingInputGuidance,
  rootPathGuidance,
} from "./errors";
import {
  commandHelp,
  GLOBAL_HELP,
  hasHelpFlag,
  isSubcommand,
  SUBCOMMANDS,
  type Subcommand,
} from "./help";
import {
  createDefaultPrompts,
  parseInitOptions,
  runInit,
  runInitWithAgent,
  type InitRuntime,
} from "./init";

const VERSION = pkg.version;

export type CliCheckOptions = {
  root: string;
  json: boolean;
  audit: boolean;
};

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Read all of stdin; injectable for tests. Used by `related --stdin`. */
  stdin?: () => string;
};

export function parseCheckOptions(args: string[]): CliCheckOptions {
  const options: CliCheckOptions = {
    root: ".",
    json: false,
    audit: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--audit") {
      options.audit = true;
      continue;
    }

    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new CliError("--root requires a path.", rootPathGuidance("check"));
      }
      options.root = root;
      index += 1;
      continue;
    }

    throw new CliError(`Unknown option: ${arg ?? ""}`, commandHelpGuidance("check"));
  }

  return options;
}

export type CliRelatedOptions = {
  root: string;
  json: boolean;
  stdin: boolean;
  gate: boolean;
  files: string[];
};

export function parseRelatedOptions(args: string[]): CliRelatedOptions {
  const options: CliRelatedOptions = {
    root: ".",
    json: false,
    stdin: false,
    gate: false,
    files: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (arg === "--gate") {
      options.gate = true;
      continue;
    }

    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new CliError("--root requires a path.", rootPathGuidance("related"));
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`, commandHelpGuidance("related"));
    }

    options.files.push(arg);
  }

  return options;
}

export type CliContextOptions = {
  root: string;
  json: boolean;
  stdin: boolean;
  files: string[];
};

export function parseContextOptions(args: string[]): CliContextOptions {
  const options: CliContextOptions = {
    root: ".",
    json: false,
    stdin: false,
    files: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new CliError("--root requires a path.", rootPathGuidance("context"));
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`, commandHelpGuidance("context"));
    }

    options.files.push(arg);
  }

  return options;
}

export type CliGraphOptions = {
  root: string;
  json: boolean;
  includeContent: boolean;
  stdin: boolean;
  files: string[];
};

export function parseGraphOptions(args: string[]): CliGraphOptions {
  const options: CliGraphOptions = {
    root: ".",
    json: false,
    includeContent: false,
    stdin: false,
    files: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--include-content") {
      options.includeContent = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new CliError("--root requires a path.", rootPathGuidance("graph"));
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`, commandHelpGuidance("graph"));
    }

    options.files.push(arg);
  }

  if (options.includeContent && !options.json) {
    throw new CliError("--include-content requires --json.", includeContentGuidance());
  }

  return options;
}

function resolveProjectRoot(root: string, command: Subcommand): string {
  const projectRoot = resolve(root);

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new CliError(`Root path does not exist: ${root}`, rootPathGuidance(command));
  }

  if (!stats.isDirectory()) {
    throw new CliError(`Root path is not a directory: ${root}`, rootPathGuidance(command));
  }

  return projectRoot;
}

function runCheck(options: CliCheckOptions, io: CliIo): number {
  const projectRoot = resolveProjectRoot(options.root, "check");
  const result = runChecker({ projectRoot, audit: options.audit });

  if (options.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = result.diagnostics.map(formatDiagnostic);
    const body = lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
    io.stdout(`${body}${formatSummary(result.summary)}\n`);
    if (result.diagnostics.some((diagnostic) => diagnostic.code === "config_file_invalid")) {
      const guidance = existsSync(join(projectRoot, CONFIG_FILE_NAME))
        ? configRepairGuidance()
        : configSetupGuidance();
      io.stderr(`${guidance}\n`);
    }
  }

  return result.summary.errors > 0 ? 1 : 0;
}

function runRelated(options: CliRelatedOptions, io: CliIo): number {
  if (!options.stdin && options.files.length === 0) {
    throw new CliError("No input files were provided.", missingInputGuidance("related"));
  }

  const projectRoot = resolveProjectRoot(options.root, "related");

  const changedFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    changedFiles.push(...readStdin().split("\n"));
  }

  const outcome = runRelatedCore({ projectRoot, changedFiles });
  if (!outcome.ok) {
    throw new DiagnosticOutputError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
  }

  if (options.gate) {
    const violations = collectGateViolations(outcome.result);
    if (options.json) {
      const gateReport = {
        violations,
        summary: {
          changedFiles: outcome.result.summary.changedFiles,
          violations: violations.length,
        },
      };
      io.stdout(`${JSON.stringify(gateReport, null, 2)}\n`);
    } else {
      io.stdout(`${formatGateResult(outcome.result, violations)}\n`);
    }
    return violations.length > 0 ? 1 : 0;
  }

  if (options.json) {
    io.stdout(`${JSON.stringify(outcome.result, null, 2)}\n`);
  } else {
    io.stdout(`${formatRelatedResult(outcome.result)}\n`);
  }

  return 0;
}

function runContext(options: CliContextOptions, io: CliIo): number {
  if (!options.stdin && options.files.length === 0) {
    throw new CliError("No input files were provided.", missingInputGuidance("context"));
  }

  const projectRoot = resolveProjectRoot(options.root, "context");

  const inputFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    inputFiles.push(...readStdin().split("\n"));
  }

  const outcome = runContextCore({ projectRoot, inputFiles });
  if (!outcome.ok) {
    throw new DiagnosticOutputError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
  }

  if (options.json) {
    io.stdout(`${JSON.stringify(outcome.result, null, 2)}\n`);
    return 0;
  }

  io.stdout(`${formatContextResult(outcome.result)}\n`);
  if (outcome.result.diagnostics.length > 0) {
    io.stderr(`${outcome.result.diagnostics.map(formatDiagnostic).join("\n")}\n`);
  }

  return 0;
}

function runGraph(options: CliGraphOptions, io: CliIo): number {
  const projectRoot = resolveProjectRoot(options.root, "graph");

  const inputFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    inputFiles.push(...readStdin().split("\n"));
  }
  const normalizedInputFiles = normalizeChangedPaths(projectRoot, inputFiles);

  const outcome = runGraphCore({
    projectRoot,
    inputFiles,
    includeContent: options.includeContent,
  });
  if (!outcome.ok) {
    throw new DiagnosticOutputError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
  }

  if (options.json) {
    io.stdout(`${JSON.stringify(outcome.result, null, 2)}\n`);
  } else {
    io.stdout(`${formatGraphResult(outcome.result, normalizedInputFiles)}\n`);
    if (outcome.result.diagnostics.length > 0) {
      io.stderr(`${outcome.result.diagnostics.map(formatDiagnostic).join("\n")}\n`);
    }
  }

  return 0;
}

function unknownCommandGuidance(command: string): string {
  const suggestion = nearestSubcommand(command);
  const lines = ["Available commands:", `  ${SUBCOMMANDS.join(", ")}`];

  if (suggestion !== undefined) {
    lines.push("", `Did you mean \`${suggestion}\`?`);
  }

  lines.push("", "Run `docbridge --help` for usage.");
  return lines.join("\n");
}

function nearestSubcommand(input: string): Subcommand | undefined {
  const abbreviation = SUBCOMMANDS.map((command, index) => ({
    command,
    distance: editDistance(input, command),
    index,
  }))
    .filter(({ command }) => isOrderedAbbreviation(input, command))
    .toSorted((left, right) => left.distance - right.distance || left.index - right.index)[0];
  if (abbreviation !== undefined) {
    return abbreviation.command;
  }

  const ranked = SUBCOMMANDS.map((command, index) => ({
    command,
    distance: editDistance(input, command),
    index,
  }));
  ranked.sort((left, right) => left.distance - right.distance || left.index - right.index);

  const best = ranked[0];
  if (best === undefined) {
    return undefined;
  }

  const closeEnough = best.distance <= Math.max(1, Math.floor(best.command.length / 2));
  return closeEnough ? best.command : undefined;
}

function isOrderedAbbreviation(input: string, command: string): boolean {
  if (input.length < 3 || input.length >= command.length) {
    return false;
  }

  let commandIndex = 0;
  for (const character of input) {
    const matchIndex = command.indexOf(character, commandIndex);
    if (matchIndex === -1) {
      return false;
    }
    commandIndex = matchIndex + 1;
  }
  return true;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}

/**
 * Execute the CLI for the given argv (without the `bun` / script prefix) and
 * return the process exit code. Output is written through the injected IO so the
 * function is unit-testable without spawning a process.
 *
 * @doc docs/specs/cli.md#check-command
 * @doc docs/user/commands.md#command-dispatch
 */
export function run(
  argv: string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  initRuntime: InitRuntime = { prompts: createDefaultPrompts() },
): number {
  const [command, ...rest] = argv;

  try {
    if (command === undefined || command === "--help" || command === "-h") {
      io.stdout(GLOBAL_HELP);
      return 0;
    }

    if (isSubcommand(command) && hasHelpFlag(rest)) {
      io.stdout(commandHelp(command));
      return 0;
    }

    if (command === "--version" || command === "-v") {
      io.stdout(`${VERSION}\n`);
      return 0;
    }

    if (command === "check") {
      return runCheck(parseCheckOptions(rest), io);
    }

    if (command === "related") {
      return runRelated(parseRelatedOptions(rest), io);
    }

    if (command === "context") {
      return runContext(parseContextOptions(rest), io);
    }

    if (command === "graph") {
      return runGraph(parseGraphOptions(rest), io);
    }

    if (command === "docs") {
      return runDocs(parseDocsCommand(rest), io);
    }

    if (command === "lsp") {
      if (rest.length > 0) {
        throw new CliError("lsp takes no options.", commandHelpGuidance("lsp"));
      }
      runLspServer();
      return 0;
    }

    if (command === "init") {
      return runInit(parseInitOptions(rest, "init"), io, initRuntime);
    }

    if (command === "init-with-agent") {
      return runInitWithAgent(parseInitOptions(rest, "init-with-agent"), io, initRuntime);
    }

    throw new CliError(`Unknown command: ${command}`, unknownCommandGuidance(command));
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`${formatCliError(error)}\n`);
      return 1;
    }
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2));
}
