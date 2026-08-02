import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "./index";

type Captured = {
  out: string;
  err: string;
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
};

function capture(): Captured {
  const state = { out: "", err: "" };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      stdout: (text: string) => {
        state.out += text;
      },
      stderr: (text: string) => {
        state.err += text;
      },
    },
  };
}

const COMMANDS = [
  "check",
  "related",
  "context",
  "graph",
  "init",
  "init-with-agent",
  "lsp",
] as const;

for (const command of COMMANDS) {
  test(`run prints ${command} help for --help and exits 0`, () => {
    const c = capture();
    const code = run([command, "--help"], c.io);

    expect(code).toBe(0);
    expect(c.out).toContain(`docbridge ${command}`);
    expect(c.out).toContain("Usage:");
    expect(c.err).toBe("");
  });

  test(`run prints ${command} help for -h and exits 0`, () => {
    const c = capture();
    const code = run([command, "-h"], c.io);

    expect(code).toBe(0);
    expect(c.out).toContain(`docbridge ${command}`);
    expect(c.err).toBe("");
  });

  test(`${command} help states when to use the command`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    const description = c.out.split("Description:")[1] ?? "";
    expect(description).toContain("Use ");
  });

  test(`${command} help documents --help itself`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    expect(c.out).toContain("--help, -h");
  });
}

test("run honors --help before validating other options", () => {
  const c = capture();
  const code = run(["context", "--nonexistent", "--help"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge context");
  expect(c.err).toBe("");
});

test("run honors --help before rejecting positional arguments", () => {
  const c = capture();
  const code = run(["init", "stray", "-h"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge init");
  expect(c.err).toBe("");
});

test("run keeps global help for --help without a command", () => {
  const c = capture();
  const code = run(["--help"], c.io);

  expect(code).toBe(0);
  expect(c.out).toContain("docbridge check");
  expect(c.out).toContain("docbridge graph");
});

test("global help distinguishes related, context, and graph by when to use them", () => {
  const c = capture();
  run(["--help"], c.io);

  const commands = c.out.split("Commands:")[1]?.split("Global options:")[0] ?? "";
  for (const command of ["related", "context", "graph"]) {
    const line = commands.split("\n").find((entry) => entry.trim().startsWith(`${command} `));
    expect(line).toBeDefined();
    expect((line ?? "").length).toBeGreaterThan(command.length + 20);
  }
});

test("run still rejects unknown commands", () => {
  const c = capture();
  const code = run(["nope", "--help"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Unknown command: nope");
});

/**
 * Guards against per-command help drifting from the parsers: every flag the
 * parser accepts must be documented in that command's help text.
 */
function parserFlags(source: string, functionName: string): string[] {
  const start = source.indexOf(`export function ${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  const body = end === -1 ? rest : rest.slice(0, end);

  return [...body.matchAll(/arg === "(--[a-z-]+)"/g)].map((match) => match[1] ?? "");
}

const CLI_SOURCE = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
const INIT_SOURCE = readFileSync(join(import.meta.dir, "init.ts"), "utf8");

const PARSERS: ReadonlyArray<readonly [string, string, string]> = [
  ["check", CLI_SOURCE, "parseCheckOptions"],
  ["related", CLI_SOURCE, "parseRelatedOptions"],
  ["context", CLI_SOURCE, "parseContextOptions"],
  ["graph", CLI_SOURCE, "parseGraphOptions"],
  ["init", INIT_SOURCE, "parseInitOptions"],
  ["init-with-agent", INIT_SOURCE, "parseInitOptions"],
];

for (const [command, source, functionName] of PARSERS) {
  test(`${command} help documents every flag its parser accepts`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    const flags = parserFlags(source, functionName);
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(c.out).toContain(flag);
    }
  });
}
