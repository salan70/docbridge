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
import type { DocBridgeDiagnostic } from "../core/types";
import { runLspServer } from "../lsp/server";
import { parseDocsCommand, runDocs } from "./docs";
import {
  CliError,
  commandHelpGuidance,
  configRepairGuidance,
  configSetupGuidance,
  DiagnosticOutputError,
  formatCliError,
  missingInputGuidance,
  rootPathGuidance,
} from "./errors";
import {
  commandHelp,
  GLOBAL_HELP,
  hasHelpFlag,
  isSubcommand,
  parseCommandOptions,
  SUBCOMMANDS,
  type Subcommand,
  type TableCommandOptions,
} from "./help";
import {
  createDefaultPrompts,
  parseInitOptions,
  runInit,
  runInitWithAgent,
  type InitRuntime,
} from "./init";

const VERSION = pkg.version;

export type CliCheckOptions = TableCommandOptions["check"];

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Read all of stdin; injectable for tests. Used by `related --stdin`. */
  stdin?: () => string;
};

export function parseCheckOptions(args: string[]): CliCheckOptions {
  return parseCommandOptions("check", args);
}

export type CliRelatedOptions = TableCommandOptions["related"];

export function parseRelatedOptions(args: string[]): CliRelatedOptions {
  return parseCommandOptions("related", args);
}

export type CliContextOptions = TableCommandOptions["context"];

export function parseContextOptions(args: string[]): CliContextOptions {
  return parseCommandOptions("context", args);
}

export type CliGraphOptions = TableCommandOptions["graph"];

export function parseGraphOptions(args: string[]): CliGraphOptions {
  return parseCommandOptions("graph", args);
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

type FileCommandOptions = {
  root: string;
  json: boolean;
  stdin: boolean;
  files: string[];
};

type FileCommandOutcome<Result> =
  | { ok: true; result: Result }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

function runFileCommand<Result>(
  command: "related" | "context" | "graph",
  options: FileCommandOptions,
  io: CliIo,
  execute: (projectRoot: string, inputFiles: string[]) => FileCommandOutcome<Result>,
  render: (result: Result, projectRoot: string, inputFiles: string[]) => number,
): number {
  const projectRoot = resolveProjectRoot(options.root, command);
  const inputFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    inputFiles.push(...readStdin().split("\n"));
  }

  const outcome = execute(projectRoot, inputFiles);
  if (!outcome.ok) {
    throw new DiagnosticOutputError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
  }
  return render(outcome.result, projectRoot, inputFiles);
}

function writeStructuredResult<Result>(
  result: Result,
  options: {
    json: boolean;
    io: CliIo;
    formatText: (result: Result) => string;
    diagnostics?: DocBridgeDiagnostic[];
  },
): void {
  if (options.json) {
    options.io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  options.io.stdout(`${options.formatText(result)}\n`);
  if (options.diagnostics !== undefined && options.diagnostics.length > 0) {
    options.io.stderr(`${options.diagnostics.map(formatDiagnostic).join("\n")}\n`);
  }
}

function runRelated(options: CliRelatedOptions, io: CliIo): number {
  if (!options.stdin && options.files.length === 0) {
    throw new CliError("No input files were provided.", missingInputGuidance("related"));
  }

  return runFileCommand(
    "related",
    options,
    io,
    (projectRoot, changedFiles) => runRelatedCore({ projectRoot, changedFiles }),
    (result) => {
      if (options.gate) {
        const violations = collectGateViolations(result);
        const gateReport = {
          violations,
          summary: {
            changedFiles: result.summary.changedFiles,
            violations: violations.length,
          },
        };
        writeStructuredResult(gateReport, {
          json: options.json,
          io,
          formatText: () => formatGateResult(result, violations),
        });
        return violations.length > 0 ? 1 : 0;
      }

      writeStructuredResult(result, {
        json: options.json,
        io,
        formatText: formatRelatedResult,
      });
      return 0;
    },
  );
}

function runContext(options: CliContextOptions, io: CliIo): number {
  if (!options.stdin && options.files.length === 0) {
    throw new CliError("No input files were provided.", missingInputGuidance("context"));
  }

  return runFileCommand(
    "context",
    options,
    io,
    (projectRoot, inputFiles) => runContextCore({ projectRoot, inputFiles }),
    (result) => {
      writeStructuredResult(result, {
        json: options.json,
        io,
        formatText: formatContextResult,
        diagnostics: result.diagnostics,
      });
      return 0;
    },
  );
}

function runGraph(options: CliGraphOptions, io: CliIo): number {
  return runFileCommand(
    "graph",
    options,
    io,
    (projectRoot, inputFiles) =>
      runGraphCore({ projectRoot, inputFiles, includeContent: options.includeContent }),
    (result, projectRoot, inputFiles) => {
      const normalizedInputFiles = normalizeChangedPaths(projectRoot, inputFiles);
      writeStructuredResult(result, {
        json: options.json,
        io,
        formatText: (graphResult) => formatGraphResult(graphResult, normalizedInputFiles),
        diagnostics: result.diagnostics,
      });
      return 0;
    },
  );
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
  const ranked = SUBCOMMANDS.map((command, index) => ({
    command,
    distance: editDistance(input, command),
    index,
  })).toSorted((left, right) => left.distance - right.distance || left.index - right.index);
  const abbreviation = ranked.find(({ command }) => isOrderedAbbreviation(input, command));
  if (abbreviation !== undefined) {
    return abbreviation.command;
  }

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

type CommandHandler = (args: string[], io: CliIo, initRuntime: InitRuntime) => number;

const COMMAND_HANDLERS: Record<Subcommand, CommandHandler> = {
  check: (args, io) => runCheck(parseCheckOptions(args), io),
  related: (args, io) => runRelated(parseRelatedOptions(args), io),
  context: (args, io) => runContext(parseContextOptions(args), io),
  graph: (args, io) => runGraph(parseGraphOptions(args), io),
  docs: (args, io) => runDocs(parseDocsCommand(args), io),
  init: (args, io, initRuntime) => runInit(parseInitOptions(args, "init"), io, initRuntime),
  "init-with-agent": (args, io, initRuntime) =>
    runInitWithAgent(parseInitOptions(args, "init-with-agent"), io, initRuntime),
  lsp: (args) => {
    if (args.length > 0) {
      throw new CliError("lsp takes no options.", commandHelpGuidance("lsp"));
    }
    runLspServer();
    return 0;
  },
};

/**
 * Execute the CLI for the given argv (without the `bun` / script prefix) and
 * return the process exit code. Output is written through the injected IO so the
 * function is unit-testable without spawning a process.
 *
 * @doc docs/specs/cli.md#check-command
 * @doc docs/user/commands.md#command-dispatch
 * @doc docs/user/commands.md#check-validate-the-project
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

    if (isSubcommand(command)) {
      return COMMAND_HANDLERS[command](rest, io, initRuntime);
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
