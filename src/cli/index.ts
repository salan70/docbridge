#!/usr/bin/env bun

import { statSync } from "node:fs";
import { resolve } from "node:path";

import pkg from "../../package.json";
import { formatDiagnostic, formatSummary } from "../core/diagnostics";
import { check as runChecker } from "../core/resolver";

const VERSION = pkg.version;

export type CliCheckOptions = {
  root: string;
  json: boolean;
  audit: boolean;
};

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

/** Raised for CLI invocation errors that must go to stderr with exit code 1. */
class CliError extends Error {}

const HELP = `SpecLink

Usage:
  speclink check [--root <path>] [--json] [--audit]

Commands:
  check    Validate links between TypeScript and Markdown.

Options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --audit        Include audit diagnostics such as undocumented_symbol.
  --version, -v  Print the SpecLink version.
  --help, -h     Print this help text.
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

    throw new CliError(`Unknown command: ${command}`);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = run(Bun.argv.slice(2));
}
