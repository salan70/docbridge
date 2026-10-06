import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { graphFrom, makeProject, type GraphSources } from "../test-support";
import { computeContext, context } from "./context";

const LOGIN_TS = [
  "/**",
  " * @doc docs/auth.md#login-spec",
  " */",
  "export function login() {}",
  "",
].join("\n");

const AUTH_MD = [
  "<!-- @code src/auth/login.ts#login -->",
  "## Login Spec",
  "",
  "The login flow.",
  "",
  "## Unrelated Section",
  "",
].join("\n");

function contentMap(sources: GraphSources): Map<string, string> {
  return new Map([...sources.code, ...sources.docs]);
}

const BASIC: GraphSources = {
  code: [["src/auth/login.ts", LOGIN_TS]],
  docs: [["docs/auth.md", AUTH_MD]],
};

test("computeContext extracts the full linked declaration including JSDoc for a doc input file", async () => {
  const result = computeContext(graphFrom(BASIC), contentMap(BASIC), ["docs/auth.md"]);

  expect(result.contexts).toEqual([
    {
      endpoint: "src/auth/login.ts#login",
      kind: "code",
      filePath: "src/auth/login.ts",
      language: "typescript",
      startLine: 1,
      endLine: 4,
      linkedFrom: ["docs/auth.md#login-spec"],
      content: "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}",
    },
  ]);
});

test("computeContext deduplicates a counterpart linked from multiple input files", async () => {
  const otherTs = [
    "/**",
    " * @doc docs/auth.md#login-spec",
    " */",
    "export function logout() {}",
    "",
  ].join("\n");
  const sources: GraphSources = {
    code: [
      ["src/auth/login.ts", LOGIN_TS],
      ["src/auth/logout.ts", otherTs],
    ],
    docs: [["docs/auth.md", AUTH_MD]],
  };

  const result = computeContext(graphFrom(sources), contentMap(sources), [
    "src/auth/logout.ts",
    "src/auth/login.ts",
  ]);

  expect(result.contexts).toHaveLength(1);
  expect(result.contexts[0]?.endpoint).toBe("docs/auth.md#login-spec");
  expect(result.contexts[0]?.linkedFrom).toEqual([
    "src/auth/login.ts#login",
    "src/auth/logout.ts#logout",
  ]);
  expect(result.summary).toEqual({ inputFiles: 2, contexts: 1 });
});

test("computeContext orders context blocks by file path then position", async () => {
  const loginTs = [
    "/**",
    " * @doc docs/b.md#b-spec",
    " * @doc docs/a.md#a-spec",
    " */",
    "export function login() {}",
    "",
  ].join("\n");
  const aMd = ["<!-- @code src/auth/login.ts#login -->", "## A Spec", ""].join("\n");
  const bMd = ["<!-- @code src/auth/login.ts#login -->", "## B Spec", ""].join("\n");
  const sources: GraphSources = {
    code: [["src/auth/login.ts", loginTs]],
    docs: [
      ["docs/b.md", bMd],
      ["docs/a.md", aMd],
    ],
  };

  const result = computeContext(graphFrom(sources), contentMap(sources), ["src/auth/login.ts"]);

  expect(result.contexts.map((block) => block.endpoint)).toEqual([
    "docs/a.md#a-spec",
    "docs/b.md#b-spec",
  ]);
});

test("computeContext slices same-line declarations by column, excluding neighbors", async () => {
  const sameLineTs = "/** @doc docs/a.md#a-spec */ export const a = 1; export const b = 2;\n";
  const aMd = ["<!-- @code src/a.ts#a -->", "## A Spec", ""].join("\n");
  const sources: GraphSources = {
    code: [["src/a.ts", sameLineTs]],
    docs: [["docs/a.md", aMd]],
  };

  const result = computeContext(graphFrom(sources), contentMap(sources), ["docs/a.md"]);

  expect(result.contexts).toEqual([
    {
      endpoint: "src/a.ts#a",
      kind: "code",
      filePath: "src/a.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      linkedFrom: ["docs/a.md#a-spec"],
      content: "/** @doc docs/a.md#a-spec */ export const a = 1;",
    },
  ]);
});

test("computeContext dedents a member declaration to its own indentation level", async () => {
  const sources: GraphSources = {
    code: [
      [
        "src/auth/service.ts",
        [
          "export class AuthService {",
          "  /**",
          "   * @doc docs/auth.md#login-spec",
          "   */",
          "  login() {",
          "    return true;",
          "  }",
          "}",
          "",
        ].join("\n"),
      ],
    ],
    docs: [
      [
        "docs/auth.md",
        ["<!-- @code src/auth/service.ts#AuthService.login -->", "## Login Spec", ""].join("\n"),
      ],
    ],
  };

  const result = computeContext(graphFrom(sources), contentMap(sources), ["docs/auth.md"]);

  expect(result.contexts[0]?.content).toBe(
    ["/**", " * @doc docs/auth.md#login-spec", " */", "login() {", "  return true;", "}"].join(
      "\n",
    ),
  );
});

test("computeContext leaves a top-level declaration unchanged", async () => {
  const result = computeContext(graphFrom(BASIC), contentMap(BASIC), ["docs/auth.md"]);

  expect(result.contexts[0]?.content).toBe(LOGIN_TS.trimEnd());
});

test("computeContext keeps the indentation of a top-level declaration whose lines are all indented", async () => {
  // With the JSDoc on the declaration's own line, every line after the first is
  // indented, which must not be mistaken for a member's enclosing indentation.
  const sources: GraphSources = {
    code: [
      [
        "src/auth/service.ts",
        ["/** @doc docs/auth.md#login-spec */ export const login =", "  compute();", ""].join("\n"),
      ],
    ],
    docs: [
      [
        "docs/auth.md",
        ["<!-- @code src/auth/service.ts#login -->", "## Login Spec", ""].join("\n"),
      ],
    ],
  };

  const result = computeContext(graphFrom(sources), contentMap(sources), ["docs/auth.md"]);

  expect(result.contexts[0]?.content).toBe(
    ["/** @doc docs/auth.md#login-spec */ export const login =", "  compute();"].join("\n"),
  );
});

function manifestProject(): string {
  return makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/auth.ts#AuthService.login", doc: "docs/auth.md#login-flow" }],
    }),
    "src/auth.ts": "export class AuthService {\n  login() {}\n}\n",
    "docs/auth.md": "## Login Flow\n\nThe service authenticates by email.\n",
  });
}

test("context returns the counterpart block of a manifest-linked symbol", async () => {
  const root = manifestProject();

  try {
    const outcome = await context({ projectRoot: root, inputFiles: ["src/auth.ts"] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.contexts.map((block) => block.endpoint)).toEqual([
      "docs/auth.md#login-flow",
    ]);
    expect(outcome.result.contexts[0]?.content).toContain("The service authenticates by email.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
