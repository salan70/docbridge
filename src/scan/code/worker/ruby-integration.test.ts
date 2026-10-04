import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { formatContextResult } from "../../../cli/render/context";
import { hover } from "../../../lsp/hover";
import { definition, references } from "../../../lsp/navigation";
import { Project } from "../../../lsp/project";
import { check } from "../../../query/check";
import { context } from "../../../query/context";
import { graph } from "../../../query/graph-output";
import { makeProject } from "../../../test-support";

/**
 * Runs the real Ruby worker through the registered adapter with the CRuby the
 * dev shell puts on `PATH`; a missing or too-old runtime fails these tests, as
 * a missing native worker binary fails the other integration tests.
 */

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../../../examples/ruby");

const CONFIG = JSON.stringify({
  include: { code: { ruby: { patterns: ["lib/**/*.rb"] } }, docs: ["docs/**/*.md"] },
});

const SERVICE = [
  "module Auth",
  "  class Service",
  "    # Starts the login flow.",
  "    #",
  "    # @doc docs/auth.md#login-flow",
  "    def login(email, password)",
  "      true",
  "    end",
  "  end",
  "end",
  "",
].join("\n");

const DOC = "<!-- @code lib/auth/service.rb#Auth::Service.login -->\n## Login Flow\n";

test("the Ruby worker participates in check, context, graph, and LSP navigation", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "lib/auth/service.rb": SERVICE,
    "docs/auth.md": DOC,
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const contextResult = await context({ projectRoot: root, inputFiles: ["docs/auth.md"] });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain(
        "```ruby\n# Starts the login flow.",
      );
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: "lib/auth/service.rb#Auth::Service.login",
        kind: "code",
        language: "ruby",
      });
    }

    const graphResult = await graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: "lib/auth/service.rb#Auth::Service.login",
        language: "ruby",
      });
    }

    const state = await new Project(root).resolveAsync().promise;
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: "lib/auth/service.rb",
        range: { start: { line: 6, column: 9 }, end: { line: 6, column: 14 } },
      },
    ]);
    expect(references(state, "lib/auth/service.rb", { line: 6, column: 10 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
    expect(hover(state, "docs/auth.md", { line: 2, column: 5 })?.value).toBe(
      "**lib/auth/service.rb#Auth::Service.login**\n\n```ruby\ndef login(email, password)\n```",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Ruby manifest entry links a singleton method with no annotation", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "lib/auth/service.rb#Auth::Service.self.build", doc: "docs/auth.md#build" }],
    }),
    "lib/auth/service.rb": "module Auth\n  class Service\n    def self.build; end\n  end\nend\n",
    "docs/auth.md": "## Build\n",
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Ruby worker ignores interpreter variables that load code or options", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "lib/auth/service.rb": SERVICE,
    "docs/auth.md": DOC,
  });
  const saved = { RUBYOPT: process.env.RUBYOPT, RUBYLIB: process.env.RUBYLIB };
  process.env.RUBYOPT = "-rdocbridge_injected_library";
  process.env.RUBYLIB = "/nonexistent-docbridge-lib";
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("a configured Ruby runtime that does not exist fails every file without fallback", async () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: { code: { ruby: { patterns: ["lib/**/*.rb"] } }, docs: ["docs/**/*.md"] },
      scanners: { ruby: { command: ["tools/missing-ruby"] } },
    }),
    "lib/a.rb": "def a; end\n",
    "lib/b.rb": "def b; end\n",
    "docs/auth.md": "## Auth\n",
  });
  try {
    const diagnostics = (await check({ projectRoot: root })).diagnostics;

    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.target])).toEqual([
      ["code_scanner_unavailable", "lib/a.rb"],
      ["code_scanner_unavailable", "lib/b.rb"],
    ]);
    expect(diagnostics[0]).toMatchObject({
      language: "ruby",
      message: expect.stringContaining("scanners.ruby.command"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Ruby example project passes check and audit", async () => {
  expect((await check({ projectRoot: EXAMPLE_ROOT, audit: true })).diagnostics).toEqual([]);

  const graphOutcome = await graph({ projectRoot: EXAMPLE_ROOT });
  expect(graphOutcome.ok).toBe(true);
  if (graphOutcome.ok) {
    expect(graphOutcome.result.pairs.map((pair) => pair.codeEndpoint).toSorted()).toEqual([
      "lib/auth/service.rb#Auth",
      "lib/auth/service.rb#Auth::MAX_ATTEMPTS",
      "lib/auth/service.rb#Auth::Service",
      "lib/auth/service.rb#Auth::Service.login",
      "lib/auth/service.rb#Auth::Service.self.build",
    ]);
  }
});

test("the Language Server scans the Ruby example asynchronously with the same result", async () => {
  const state = await new Project(EXAMPLE_ROOT).resolveAsync().promise;

  expect(state.contentByFile.has("lib/auth/service.rb")).toBe(true);
  expect(state).toEqual(await new Project(EXAMPLE_ROOT).resolveAsync().promise);
});
