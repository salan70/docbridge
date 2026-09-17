#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import pkg from "../../package.json";
import { CONFIG_FILE_NAME } from "../core/config";
import { context as runContextCore, formatContextResult } from "../core/context";
import { formatDiagnostic, formatSummary } from "../core/diagnostics";
import { formatGraphResult, graph as runGraphCore } from "../core/graph-output";
import { LINK_MANIFEST_FILE_NAME } from "../core/link-manifest";
import { resolvePackageRoot } from "../core/package-root";
import {
  collectGateViolations,
  formatGateResult,
  formatRelatedResult,
  normalizeChangedPaths,
  related as runRelatedCore,
} from "../core/related";
import { check as runChecker } from "../core/resolver";
import { nearestMatch } from "../core/suggest";
import type { DocBridgeDiagnostic } from "../core/types";
import { runLspServer } from "../lsp/server";
import { resolveLatestStableVersion, type LatestVersionLookup } from "../setup/registry";
import {
  decideUpdateCheck,
  formatUpdateNotice,
  isUpdateCheckOptedOut,
} from "../setup/update-notice";
import { detectUpgradeGuidance } from "../setup/upgrade-guidance";
import { parseDocsCommand, runDocs } from "./docs";
import {
  CliError,
  commandHelpGuidance,
  configRepairGuidance,
  configSetupGuidance,
  manifestRepairGuidance,
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
import type { CliIo } from "./io";
import { parseUpgradeOptions, runUpgrade } from "./upgrade";

const VERSION = pkg.version;

export type CliCheckOptions = TableCommandOptions["check"];

/**
 * Ambient state the CLI needs but cannot obtain synchronously or from argv:
 * the registry lookup performed by the async entry point, the environment that
 * gates the update notice, and whether stderr is a terminal. Every field is
 * optional so unit tests can drive `run` exactly as before.
 */
export type CliRuntime = {
  latest?: LatestVersionLookup;
  env?: Readonly<Record<string, string | undefined>>;
  isTty?: boolean;
  /** Defaults to the process working directory; injectable for tests. */
  currentDirectory?: string;
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
    io.stdout(
      `${body}${formatSummary(result.summary)}\nSee \`docbridge docs show troubleshooting\` for diagnostic codes and fixes.\n`,
    );
    const guidance = repairGuidanceFor(result.diagnostics, projectRoot);
    if (guidance !== undefined) {
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

/**
 * Pick the next action for an unreadable configuration or link manifest.
 *
 * Both report `config_file_invalid`, so the target decides which file the
 * reader is sent to. A missing configuration gets setup guidance instead of
 * repair guidance; the manifest is optional and never missing in this sense.
 */
function repairGuidanceFor(
  diagnostics: DocBridgeDiagnostic[],
  projectRoot: string,
): string | undefined {
  const invalid = diagnostics.filter((diagnostic) => diagnostic.code === "config_file_invalid");
  if (invalid.some((diagnostic) => diagnostic.target === LINK_MANIFEST_FILE_NAME)) {
    return manifestRepairGuidance();
  }
  if (invalid.length === 0) {
    return undefined;
  }
  return existsSync(join(projectRoot, CONFIG_FILE_NAME))
    ? configRepairGuidance()
    : configSetupGuidance();
}

function unknownCommandGuidance(command: string): string {
  const suggestion = nearestMatch(command, SUBCOMMANDS);
  const lines = ["Available commands:", `  ${SUBCOMMANDS.join(", ")}`];

  if (suggestion !== undefined) {
    lines.push("", `Did you mean \`${suggestion}\`?`);
  }

  lines.push("", "Run `docbridge --help` for usage.");
  return lines.join("\n");
}

type CommandHandler = (
  args: string[],
  io: CliIo,
  initRuntime: InitRuntime,
  cliRuntime: CliRuntime,
) => number;

const COMMAND_HANDLERS: Record<Subcommand, CommandHandler> = {
  check: (args, io) => runCheck(parseCheckOptions(args), io),
  related: (args, io) => runRelated(parseRelatedOptions(args), io),
  context: (args, io) => runContext(parseContextOptions(args), io),
  graph: (args, io) => runGraph(parseGraphOptions(args), io),
  docs: (args, io) => runDocs(parseDocsCommand(args), io),
  init: (args, io, initRuntime) => runInit(parseInitOptions(args, "init"), io, initRuntime),
  "init-with-agent": (args, io, initRuntime) =>
    runInitWithAgent(parseInitOptions(args, "init-with-agent"), io, initRuntime),
  upgrade: (args, io, initRuntime, cliRuntime) =>
    runUpgrade(parseUpgradeOptions(args), io, initRuntime, {
      latest: cliRuntime.latest ?? { status: "unavailable", source: "network" },
      currentVersion: VERSION,
      ...(cliRuntime.env !== undefined ? { env: cliRuntime.env } : {}),
      ...(cliRuntime.currentDirectory !== undefined
        ? { currentDirectory: cliRuntime.currentDirectory }
        : {}),
    }),
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
 */
export function run(
  argv: string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  initRuntime: InitRuntime = { prompts: createDefaultPrompts() },
  cliRuntime: CliRuntime = {},
): number {
  const [command, ...rest] = argv;

  try {
    if (command === undefined || command === "--help" || command === "-h") {
      io.stdout(GLOBAL_HELP);
      writeUpdateNotice(argv, io, initRuntime, cliRuntime);
      return 0;
    }

    if (isSubcommand(command) && hasHelpFlag(rest)) {
      io.stdout(commandHelp(command));
      return 0;
    }

    if (command === "--version" || command === "-v") {
      io.stdout(`${VERSION}\n`);
      writeUpdateNotice(argv, io, initRuntime, cliRuntime);
      return 0;
    }

    if (isSubcommand(command)) {
      const exitCode = COMMAND_HANDLERS[command](rest, io, initRuntime, cliRuntime);
      writeUpdateNotice(argv, io, initRuntime, cliRuntime);
      return exitCode;
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

/**
 * Resolve the project the invocation acted on, so upgrade guidance describes
 * the installation that produced the notice rather than whatever directory the
 * user happened to stand in. Commands that take `--root` all spell it the same
 * way, and a positional argument can never look like the flag.
 */
function rootOptionOf(argv: readonly string[], currentDirectory: string): string {
  const flagIndex = argv.indexOf("--root");
  const value = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  return value === undefined ? currentDirectory : resolve(currentDirectory, value);
}

/**
 * Print the passive "update available" aside on stderr.
 *
 * It is deliberately the last thing a successful invocation writes and it
 * never influences the exit code, so adding the check cannot change what an
 * existing consumer of DocBridge output observes on stdout.
 */
function writeUpdateNotice(
  argv: string[],
  io: CliIo,
  initRuntime: InitRuntime,
  cliRuntime: CliRuntime,
): void {
  const latest = cliRuntime.latest;
  if (latest === undefined || latest.status !== "ok") {
    return;
  }
  if (
    !decideUpdateCheck({
      argv,
      ...(cliRuntime.env !== undefined ? { env: cliRuntime.env } : {}),
      isTty: cliRuntime.isTty ?? false,
    }).enabled
  ) {
    return;
  }

  const packageRoot = initRuntime.packageRoot ?? resolvePackageRoot();
  const currentDirectory = cliRuntime.currentDirectory ?? process.cwd();
  const notice = formatUpdateNotice({
    current: VERSION,
    latest: latest.latest,
    guidance: detectUpgradeGuidance({
      packageRoot,
      projectRoot: rootOptionOf(argv, currentDirectory),
      currentDirectory,
      ...(cliRuntime.env !== undefined ? { env: cliRuntime.env } : {}),
    }),
  });
  if (notice !== undefined) {
    io.stderr(notice);
  }
}

/**
 * Resolve the registry lookup this invocation needs, if any.
 *
 * `upgrade` asks for a fresh answer because the user requested the diagnosis;
 * every other command is limited to the daily cache so a routine `check` never
 * pays for the network more than once a day, and never at all when the notice
 * is suppressed.
 */
async function resolveLatestForInvocation(
  argv: string[],
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
): Promise<LatestVersionLookup | undefined> {
  if (isUpdateCheckOptedOut(env)) {
    return undefined;
  }
  if (argv[0] === "upgrade" && !hasHelpFlag(argv.slice(1))) {
    return resolveLatestStableVersion({ forceRefresh: true });
  }
  if (!decideUpdateCheck({ argv, env, isTty }).enabled) {
    return undefined;
  }
  return resolveLatestStableVersion();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const isTty = process.stderr.isTTY === true;
  const latest = await resolveLatestForInvocation(argv, process.env, isTty);
  process.exitCode = run(
    argv,
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    { prompts: createDefaultPrompts() },
    { ...(latest !== undefined ? { latest } : {}), env: process.env, isTty },
  );
}
