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
 * Runs the real Java worker JAR through the registered adapter with the JDK
 * the dev shell puts on `PATH`; a missing JAR (`just build-java-scanner`) or a
 * missing or too-old JDK fails these tests, as a missing native worker binary
 * fails the other integration tests.
 */

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../../../examples/java");

const CONFIG = JSON.stringify({
  include: { code: { java: { patterns: ["src/main/java/**/*.java"] } }, docs: ["docs/**/*.md"] },
});

const SERVICE_PATH = "src/main/java/auth/AuthService.java";

const SERVICE = [
  "package auth;",
  "",
  "public class AuthService {",
  "  /**",
  "   * Starts the login flow.",
  "   *",
  "   * @doc docs/auth.md#login-flow",
  "   */",
  "  @Deprecated",
  "  public void login(String email, char[] password) {}",
  "}",
  "",
].join("\n");

const LOGIN = `${SERVICE_PATH}#AuthService.login(String,char[])`;

const DOC = `<!-- @code ${LOGIN} -->\n## Login Flow\n`;

test("the Java worker participates in check, context, graph, and LSP navigation", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    [SERVICE_PATH]: SERVICE,
    "docs/auth.md": DOC,
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);

    const contextResult = await context({ projectRoot: root, inputFiles: ["docs/auth.md"] });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(formatContextResult(contextResult.result)).toContain(
        "```java\n/**\n * Starts the login flow.",
      );
      expect(contextResult.result.contexts[0]).toMatchObject({
        endpoint: LOGIN,
        kind: "code",
        language: "java",
      });
    }

    const graphResult = await graph({ projectRoot: root, includeContent: true });
    expect(graphResult.ok).toBe(true);
    if (graphResult.ok) {
      expect(graphResult.result.nodes.find((node) => node.kind === "code")).toMatchObject({
        endpoint: LOGIN,
        language: "java",
      });
    }

    const state = await new Project(root).resolveAsync().promise;
    expect(state.diagnostics).toEqual([]);
    expect(definition(state, "docs/auth.md", { line: 2, column: 5 })).toEqual([
      {
        filePath: SERVICE_PATH,
        range: { start: { line: 10, column: 15 }, end: { line: 10, column: 20 } },
      },
    ]);
    expect(references(state, SERVICE_PATH, { line: 10, column: 16 })).toEqual([
      {
        filePath: "docs/auth.md",
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
    expect(hover(state, "docs/auth.md", { line: 2, column: 5 })?.value).toBe(
      `**${LOGIN}**\n\n\`\`\`java\n@Deprecated\npublic void login(String email, char[] password)\n\`\`\``,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Java manifest entry links a constructor with no Javadoc", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    "docbridge.links.json": JSON.stringify({
      links: [{ code: `${SERVICE_PATH}#AuthService.AuthService(String)`, doc: "docs/auth.md#new" }],
    }),
    [SERVICE_PATH]:
      "package auth;\n\npublic class AuthService {\n  public AuthService(String realm) {}\n}\n",
    "docs/auth.md": "## New\n",
  });
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Java worker ignores runtime variables that inject options", async () => {
  const root = makeProject({
    "docbridge.config.json": CONFIG,
    [SERVICE_PATH]: SERVICE,
    "docs/auth.md": DOC,
  });
  // Each variable passes the JVM an option it rejects at start-up, so any
  // variable that reaches the probe or the worker fails the scan.
  const saved = new Map<string, string | undefined>();
  for (const name of ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"]) {
    saved.set(name, process.env[name]);
    process.env[name] = "-Xdocbridge-bogus-option";
  }
  try {
    expect((await check({ projectRoot: root })).diagnostics).toEqual([]);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("a configured Java runtime that does not exist fails every file without fallback", async () => {
  const root = makeProject({
    "docbridge.config.json": JSON.stringify({
      include: { code: { java: { patterns: ["src/**/*.java"] } }, docs: ["docs/**/*.md"] },
      scanners: { java: { command: ["tools/jdk/bin/java"] } },
    }),
    "src/A.java": "public class A {}\n",
    "src/B.java": "public class B {}\n",
    "docs/auth.md": "## Auth\n",
  });
  try {
    const diagnostics = (await check({ projectRoot: root })).diagnostics;

    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.target])).toEqual([
      ["code_scanner_unavailable", "src/A.java"],
      ["code_scanner_unavailable", "src/B.java"],
    ]);
    expect(diagnostics[0]).toMatchObject({
      language: "java",
      message: expect.stringContaining("scanners.java.command"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Java example project passes check and audit", async () => {
  expect((await check({ projectRoot: EXAMPLE_ROOT, audit: true })).diagnostics).toEqual([]);

  const graphOutcome = await graph({ projectRoot: EXAMPLE_ROOT });
  expect(graphOutcome.ok).toBe(true);
  if (graphOutcome.ok) {
    expect(graphOutcome.result.pairs.map((pair) => pair.codeEndpoint).toSorted()).toEqual([
      "src/main/java/com/example/auth/AuthService.java#AuthService",
      "src/main/java/com/example/auth/AuthService.java#AuthService.AuthService(Authenticator)",
      "src/main/java/com/example/auth/AuthService.java#AuthService.MAX_ATTEMPTS",
      "src/main/java/com/example/auth/AuthService.java#AuthService.login(String,char[])",
      "src/main/java/com/example/auth/AuthService.java#AuthService.login(String,char[],String[])",
      "src/main/java/com/example/auth/Authenticator.java#Authenticator",
      "src/main/java/com/example/auth/Authenticator.java#Authenticator.authenticate(String,char[])",
    ]);
  }
});

test("the Language Server scans the Java example asynchronously with the same result", async () => {
  const state = await new Project(EXAMPLE_ROOT).resolveAsync().promise;

  expect(state.contentByFile.has("src/main/java/com/example/auth/AuthService.java")).toBe(true);
  expect(state).toEqual(await new Project(EXAMPLE_ROOT).resolveAsync().promise);
});
