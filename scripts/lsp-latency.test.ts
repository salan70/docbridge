import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { formatLatencyReport, measureLatency, parseLatencyArgs, percentile } from "./lsp-latency";

const repoRoot = resolve(import.meta.dir, "..");

describe(parseLatencyArgs, () => {
  test("defaults to 20 server starts with 5 edits each", () => {
    expect(parseLatencyArgs([])).toEqual({ runs: 20, edits: 5 });
  });

  test("reads --runs and --edits", () => {
    expect(parseLatencyArgs(["--edits", "2", "--runs", "3"])).toEqual({ runs: 3, edits: 2 });
  });

  test.each([
    [["--iterations", "3"], "Unknown argument: --iterations. Usage: [--runs N] [--edits N]"],
    [["--runs"], "--runs takes a positive integer."],
    [["--edits", "0"], "--edits takes a positive integer."],
    [["--runs", "1.5"], "--runs takes a positive integer."],
  ])("rejects %j", (args, message) => {
    expect(() => parseLatencyArgs(args)).toThrow(message);
  });
});

describe(percentile, () => {
  test("takes the nearest rank of the sorted samples", () => {
    const samples = [50, 10, 40, 20, 30];

    expect(percentile(samples, 50)).toBe(30);
    expect(percentile(samples, 95)).toBe(50);
    expect(percentile(samples, 100)).toBe(50);
  });

  test("ranks 95 of 20 samples at the 19th", () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);

    expect(percentile(samples, 95)).toBe(19);
  });

  test("needs a sample", () => {
    expect(() => percentile([], 50)).toThrow("A percentile needs at least one sample.");
  });
});

test("formatLatencyReport prints the count, p50, p95, and maximum of each kind", () => {
  expect(formatLatencyReport({ cold: [900.4, 1100.6], warm: [300, 310.2, 290] })).toBe(
    "cold (server start to first publish): n=2 p50=900 ms p95=1101 ms max=1101 ms\n" +
      "warm (edit to the next publish): n=3 p50=300 ms p95=310 ms max=310 ms",
  );
});

/**
 * A language server that publishes empty diagnostics for every opened or
 * edited document and answers every request with no result, so it knows no
 * Java endpoint: what a server that rejects `include.code.java` looks like.
 */
const SERVER_WITHOUT_JAVA = `
let buffered = Buffer.alloc(0);
function send(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}
function handle(message) {
  if (message.method === "exit") process.exit(0);
  if (message.method === "textDocument/didOpen" || message.method === "textDocument/didChange") {
    const uri = message.params.textDocument.uri;
    send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
  }
  if (message.id !== undefined) {
    send({ id: message.id, result: message.method === "initialize" ? { capabilities: {} } : null });
  }
}
process.stdin.on("data", (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  for (;;) {
    const headerEnd = buffered.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const length = Number(/Content-Length: (\\d+)/.exec(buffered.subarray(0, headerEnd).toString())[1]);
    if (buffered.length < headerEnd + 4 + length) return;
    handle(JSON.parse(buffered.subarray(headerEnd + 4, headerEnd + 4 + length).toString()));
    buffered = buffered.subarray(headerEnd + 4 + length);
  }
});
`;

test("measureLatency fails, without timing anything, when the server never starts", async () => {
  const outcome = Promise.race([
    measureLatency(["docbridge-no-such-executable"], { runs: 1, edits: 1 }).then(
      () => "measured",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ),
    new Promise((settle) => {
      setTimeout(() => settle("still waiting"), 5000);
    }),
  ]);

  expect(await outcome).toStartWith("Language server failed to start");
}, 10_000);

test("measureLatency fails when the server publishes no diagnostics but scanned no Java", async () => {
  const root = mkdtempSync(join(tmpdir(), "docbridge-lsp-latency-"));
  try {
    const server = join(root, "server.js");
    writeFileSync(server, SERVER_WITHOUT_JAVA);

    await expect(measureLatency(["bun", server], { runs: 1, edits: 1 })).rejects.toThrow(
      "The server links nothing at AuthService in AuthService.java, so the Java worker did not scan it and nothing was timed.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("measureLatency times a cold start and an edit on the Java example", async () => {
  const samples = await measureLatency(
    ["bun", "run", resolve(repoRoot, "src/cli/index.ts"), "lsp"],
    { runs: 1, edits: 1 },
  );

  expect(samples.cold).toHaveLength(1);
  expect(samples.warm).toHaveLength(1);
  for (const value of [...samples.cold, ...samples.warm]) {
    expect(value).toBeGreaterThan(0);
  }
}, 120_000);
