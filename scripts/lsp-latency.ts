#!/usr/bin/env bun

// Measures how long the built Language Server takes to publish diagnostics for
// a Java file of examples/java: cold, from starting the server to its first
// publish, and warm, from an edit to the publish of the rescan it causes.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { documentUri, startLspSession } from "./lsp-client";

const repoRoot = resolve(import.meta.dir, "..");
const EXAMPLE_ROOT = join(repoRoot, "examples/java");
const DOCUMENT = join(EXAMPLE_ROOT, "src/main/java/com/example/auth/AuthService.java");
const BUILT_CLI = join(repoRoot, "dist/index.js");

/** Generous, because a cold publish includes the runtime probe and a JVM start. */
const PUBLISH_TIMEOUT_MS = 60_000;

/**
 * The pause before each edit, so a scan scheduled by the start-up or by the
 * previous edit has published before the next measured edit is sent.
 */
const SETTLE_MS = 500;

export type LatencyOptions = {
  /** Server starts; each one yields a cold sample. */
  runs: number;
  /** Edits per server start; each one yields a warm sample. */
  edits: number;
};

/** Latencies in milliseconds. */
export type LatencySamples = {
  cold: number[];
  warm: number[];
};

const DEFAULT_OPTIONS: LatencyOptions = { runs: 20, edits: 5 };

/** Read `--runs N` and `--edits N`; both default as in {@link DEFAULT_OPTIONS}. */
export function parseLatencyArgs(args: readonly string[]): LatencyOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = Number(args[index + 1]);
    if (flag !== "--runs" && flag !== "--edits") {
      throw new Error(`Unknown argument: ${String(flag)}. Usage: [--runs N] [--edits N]`);
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${flag} takes a positive integer.`);
    }
    options[flag === "--runs" ? "runs" : "edits"] = value;
  }
  return options;
}

/** The nearest-rank `p`th percentile of `samples`, for `p` in (0, 100]. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = samples.toSorted((left, right) => left - right);
  const value = sorted[Math.max(Math.ceil((p / 100) * sorted.length), 1) - 1];
  if (value === undefined) {
    throw new Error("A percentile needs at least one sample.");
  }
  return value;
}

/** One line per kind: the sample count, p50, p95, and the maximum, in whole milliseconds. */
export function formatLatencyReport(samples: LatencySamples): string {
  return [
    summaryLine("cold (server start to first publish)", samples.cold),
    summaryLine("warm (edit to the next publish)", samples.warm),
  ].join("\n");
}

function milliseconds(value: number): string {
  return `${Math.round(value)} ms`;
}

function summaryLine(label: string, values: readonly number[]): string {
  return (
    `${label}: n=${values.length} p50=${milliseconds(percentile(values, 50))} ` +
    `p95=${milliseconds(percentile(values, 95))} max=${milliseconds(percentile(values, 100))}`
  );
}

/**
 * Start the server `options.runs` times with `command` on examples/java. Each
 * start opens `AuthService.java` and times the first publish for it, then
 * sends `options.edits` full-text edits, each appending a distinct comment so
 * the scan cache cannot answer it, and times the publish each one causes. The
 * example is clean, so any published diagnostic means the scan did not run
 * the worker, and the measurement fails instead of timing that.
 */
export async function measureLatency(
  command: readonly string[],
  options: LatencyOptions,
): Promise<LatencySamples> {
  const uri = documentUri(DOCUMENT);
  const original = readFileSync(DOCUMENT, "utf8");
  const samples: LatencySamples = { cold: [], warm: [] };

  for (let run = 0; run < options.runs; run += 1) {
    const startedAt = performance.now();
    const session = startLspSession([...command], EXAMPLE_ROOT, {
      requestTimeoutMs: PUBLISH_TIMEOUT_MS,
    });
    try {
      await session.initialize(EXAMPLE_ROOT);
      session.openDocument(uri, "java", original);
      const first = await session.waitForPublishNumber(uri, 1, PUBLISH_TIMEOUT_MS);
      assertClean(first.diagnostics);
      samples.cold.push(first.receivedAt - startedAt);

      for (let edit = 0; edit < options.edits; edit += 1) {
        await sleep(SETTLE_MS);
        const published = session.publishCount(uri);
        const sentAt = performance.now();
        session.notify("textDocument/didChange", {
          textDocument: { uri, version: edit + 2 },
          contentChanges: [{ text: `${original}// latency edit ${run}.${edit}\n` }],
        });
        const next = await session.waitForPublishNumber(uri, published + 1, PUBLISH_TIMEOUT_MS);
        assertClean(next.diagnostics);
        samples.warm.push(next.receivedAt - sentAt);
      }
    } finally {
      await session.stop();
    }
  }
  return samples;
}

function assertClean(diagnostics: readonly Record<string, unknown>[]): void {
  if (diagnostics.length > 0) {
    const messages = diagnostics.map((diagnostic) => String(diagnostic.message)).join("; ");
    throw new Error(`The Java example published diagnostics, so no scan was timed: ${messages}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((settle) => {
    setTimeout(settle, ms);
  });
}

if (import.meta.main) {
  try {
    const options = parseLatencyArgs(Bun.argv.slice(2));
    if (!existsSync(BUILT_CLI)) {
      throw new Error("dist/index.js does not exist. Run `just build` first.");
    }
    console.log(
      `Timing ${options.runs} server starts and ${options.runs * options.edits} edits on examples/java...`,
    );
    const samples = await measureLatency(["node", BUILT_CLI, "lsp"], options);
    console.log(formatLatencyReport(samples));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
