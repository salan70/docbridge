#!/usr/bin/env bun

export type CheckOptions = {
  root: string;
  json: boolean;
  audit: boolean;
};

function printHelp(): void {
  console.log(`SpecLink

Usage:
  speclink check [--root <path>] [--json] [--audit]

Commands:
  check    Validate links between TypeScript and Markdown.

Options:
  --root <path>  Project root to scan. Defaults to current directory.
  --json         Emit machine-readable JSON.
  --audit        Include audit diagnostics such as undocumented_symbol.
`);
}

export function parseCheckOptions(args: string[]): CheckOptions {
  const options: CheckOptions = {
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
        throw new Error("--root requires a path.");
      }
      options.root = root;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg ?? ""}`);
  }

  return options;
}

function runCheck(options: CheckOptions): number {
  const result = {
    diagnostics: [],
    summary: {
      errors: 0,
      warnings: 0,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`SpecLink check is not implemented yet.

Planned scan root: ${options.root}
Audit diagnostics: ${options.audit ? "enabled" : "disabled"}
`);
  }

  return 0;
}

function main(args: string[]): number {
  const [command, ...rest] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "check") {
    const options = parseCheckOptions(rest);
    return runCheck(options);
  }

  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) {
  try {
    process.exitCode = main(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
