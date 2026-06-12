#!/usr/bin/env bun

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import pkg from "../../package.json";
import { context as runContextCore, formatContextResult } from "../core/context";
import { formatDiagnostic, formatSummary } from "../core/diagnostics";
import {
  collectGateViolations,
  formatGateResult,
  formatRelatedResult,
  related as runRelatedCore,
} from "../core/related";
import { check as runChecker } from "../core/resolver";
import { runLspServer } from "../lsp/server";

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

/** Raised for CLI invocation errors that must go to stderr with exit code 1. */
class CliError extends Error {}

const HELP = `SpecLink

Usage:
  speclink [--version] [--help]
  speclink check [--root <path>] [--json] [--audit]
  speclink related [--root <path>] [--json] [--stdin] [--gate] [files...]
  speclink context [--root <path>] [--json] [--stdin] [files...]
  speclink lsp

Commands:
  check    Validate links between TypeScript and Markdown.
  related  List the linked counterparts of the given changed files.
  context  Print the content of the counterparts linked from the given files.
  lsp      Run the Language Server over stdio.

Global options:
  --version, -v  Print the SpecLink version.
  --help, -h     Print this help text.

Check options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --audit        Include audit diagnostics such as undocumented_symbol.

Related options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --stdin        Read newline-separated file paths from stdin.
  --gate         Report counterparts that are not in the change set and exit 1 if any.

Context options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --stdin        Read newline-separated file paths from stdin.
`;

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
        throw new CliError("--root requires a path.");
      }
      options.root = root;
      index += 1;
      continue;
    }

    throw new CliError(`Unknown option: ${arg ?? ""}`);
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
        throw new CliError("--root requires a path.");
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`);
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
        throw new CliError("--root requires a path.");
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`);
    }

    options.files.push(arg);
  }

  return options;
}

function resolveProjectRoot(root: string): string {
  const projectRoot = resolve(root);

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new CliError(`Root path does not exist: ${root}`);
  }

  if (!stats.isDirectory()) {
    throw new CliError(`Root path is not a directory: ${root}`);
  }

  return projectRoot;
}

function runCheck(options: CliCheckOptions, io: CliIo): number {
  const projectRoot = resolveProjectRoot(options.root);
  const result = runChecker({ projectRoot, audit: options.audit });

  if (options.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = result.diagnostics.map(formatDiagnostic);
    const body = lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
    io.stdout(`${body}${formatSummary(result.summary)}\n`);
  }

  return result.summary.errors > 0 ? 1 : 0;
}

function runRelated(options: CliRelatedOptions, io: CliIo): number {
  if (!options.stdin && options.files.length === 0) {
    throw new CliError("Provide file paths as arguments or use --stdin.");
  }

  const projectRoot = resolveProjectRoot(options.root);

  const changedFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    changedFiles.push(...readStdin().split("\n"));
  }

  const outcome = runRelatedCore({ projectRoot, changedFiles });
  if (!outcome.ok) {
    throw new CliError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
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
    throw new CliError("Provide file paths as arguments or use --stdin.");
  }

  const projectRoot = resolveProjectRoot(options.root);

  const inputFiles = [...options.files];
  if (options.stdin) {
    const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
    inputFiles.push(...readStdin().split("\n"));
  }

  const outcome = runContextCore({ projectRoot, inputFiles });
  if (!outcome.ok) {
    throw new CliError(outcome.diagnostics.map(formatDiagnostic).join("\n"));
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

/**
 * Execute the CLI for the given argv (without the `bun` / script prefix) and
 * return the process exit code. Output is written through the injected IO so the
 * function is unit-testable without spawning a process.
 *
 * @doc docs/specs/cli.md#check-command
 */
export function run(
  argv: string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): number {
  try {
    const [command, ...rest] = argv;

    if (command === undefined || command === "--help" || command === "-h") {
      io.stdout(HELP);
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

    if (command === "lsp") {
      if (rest.length > 0) {
        throw new CliError("lsp takes no options.");
      }
      runLspServer();
      return 0;
    }

    throw new CliError(`Unknown command: ${command}`);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = run(Bun.argv.slice(2));
}
