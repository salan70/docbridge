#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Run the Rust `phase0-runner` over every frozen Phase 0 case and diff its
 * output against `expected.json` after canonical JSON formatting. Only object
 * key order is normalized; array order, positions, and messages are
 * contractual and compared as is.
 */
const REPO_ROOT = resolve(import.meta.dir, "..");
const CASE_ROOTS = ["test-fixtures/phase0/specified", "test-fixtures/phase0/generated"];
const RUNNER = join(REPO_ROOT, "packages/rust-core-experiment/target/release/phase0-runner");

/** Serialize with object keys sorted at every depth; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function listCases(caseRoots: string[]): { name: string; caseDir: string }[] {
  const cases: { name: string; caseDir: string }[] = [];
  for (const relRoot of caseRoots) {
    const root = join(REPO_ROOT, relRoot);
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true }).toSorted((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) {
        cases.push({ name: `${relRoot}/${entry.name}`, caseDir: join(root, entry.name) });
      }
    }
  }
  return cases;
}

/** First differing line of two canonical texts, for a short failure report. */
function firstDifference(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const limit = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < limit; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `line ${index + 1}:\n    expected: ${expectedLines[index] ?? "<eof>"}\n    actual:   ${actualLines[index] ?? "<eof>"}`;
    }
  }
  return "no textual difference";
}

/**
 * Without arguments, run the frozen `specified/` and `generated/` cases. Case
 * roots passed as arguments replace them, which is how a reviewer runs the
 * held-out set: `bun run scripts/phase0-parity.ts test-fixtures/phase0-heldout`.
 */
function main(args: string[]): number {
  if (!existsSync(RUNNER)) {
    console.error(`phase0-runner is not built: ${RUNNER}`);
    return 1;
  }
  const failures: string[] = [];
  const cases = listCases(args.length === 0 ? CASE_ROOTS : args);
  for (const { name, caseDir } of cases) {
    const input = readFileSync(join(caseDir, "input.json"));
    const expected = canonicalJson(
      JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8")),
    );
    const result = Bun.spawnSync([RUNNER], { stdin: input, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      failures.push(
        `${name}: runner exited ${result.exitCode}\n  ${result.stderr.toString().trim()}`,
      );
      continue;
    }
    let actual: string;
    try {
      actual = canonicalJson(JSON.parse(result.stdout.toString()));
    } catch (error) {
      failures.push(`${name}: runner wrote invalid JSON (${String(error)})`);
      continue;
    }
    if (actual !== expected) {
      failures.push(`${name}: output differs at ${firstDifference(expected, actual)}`);
    }
  }

  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  console.log(`phase0-parity: ${cases.length - failures.length}/${cases.length} cases pass`);
  return failures.length === 0 && cases.length > 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
