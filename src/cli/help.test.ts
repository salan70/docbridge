import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "./index";
import { capture } from "./test-support";

const COMMANDS = [
  "check",
  "related",
  "context",
  "graph",
  "docs",
  "init",
  "init-with-agent",
  "upgrade",
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

test("run still rejects unknown commands", () => {
  const c = capture();
  const code = run(["nope", "--help"], c.io);

  expect(code).toBe(1);
  expect(c.err).toContain("Unknown command: nope");
});

function parserFlags(source: string, functionName: string): string[] {
  const start = source.indexOf(`export function ${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}");
  const body = end === -1 ? rest : rest.slice(0, end);

  return [...body.matchAll(/arg === "(--[a-z-]+)"/g)].map((match) => match[1] ?? "");
}

const DOCS_SOURCE = readFileSync(join(import.meta.dir, "docs.ts"), "utf8");
const INIT_SOURCE = readFileSync(join(import.meta.dir, "init.ts"), "utf8");

const HAND_WRITTEN_PARSERS = [
  ["docs", DOCS_SOURCE, "parseDocsCommand"],
  ["init", INIT_SOURCE, "parseInitOptions"],
  ["init-with-agent", INIT_SOURCE, "parseInitOptions"],
] as const;

for (const [command, source, functionName] of HAND_WRITTEN_PARSERS) {
  test(`${command} help documents every flag its hand-written parser accepts`, () => {
    const c = capture();
    run([command, "--help"], c.io);

    const flags = parserFlags(source, functionName);
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(c.out).toContain(flag);
    }
  });
}
