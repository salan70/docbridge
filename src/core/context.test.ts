import { expect, test } from "bun:test";

import { computeContext, formatContextResult } from "./context";
import { graphFrom, type GraphSources } from "./test-support";

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

test("computeContext extracts the linked doc section for a code input file", () => {
  const result = computeContext(graphFrom(BASIC), contentMap(BASIC), ["src/auth/login.ts"]);

  expect(result).toEqual({
    contexts: [
      {
        endpoint: "docs/auth.md#login-spec",
        kind: "doc",
        filePath: "docs/auth.md",
        startLine: 2,
        endLine: 4,
        linkedFrom: ["src/auth/login.ts#login"],
        content: "## Login Spec\n\nThe login flow.",
      },
    ],
    summary: { inputFiles: 1, contexts: 1 },
  });
});

test("computeContext extracts the full linked declaration including JSDoc for a doc input file", () => {
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

test("computeContext deduplicates a counterpart linked from multiple input files", () => {
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

test("computeContext orders context blocks by file path then position", () => {
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

test("computeContext slices same-line declarations by column, excluding neighbors", () => {
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

test("computeContext returns no blocks for input files without links", () => {
  const result = computeContext(graphFrom(BASIC), contentMap(BASIC), ["bun.lock", "src/other.ts"]);

  expect(result.contexts).toEqual([]);
  expect(result.summary).toEqual({ inputFiles: 2, contexts: 0 });
});

test("formatContextResult renders doc sections raw and code declarations fenced", () => {
  const sources: GraphSources = {
    code: [["src/auth/login.ts", LOGIN_TS]],
    docs: [["docs/auth.md", AUTH_MD]],
  };
  const graph = graphFrom(sources);
  const contents = contentMap(sources);
  const result = {
    ...computeContext(graph, contents, ["src/auth/login.ts", "docs/auth.md"]),
    diagnostics: [],
  };

  expect(formatContextResult(result)).toBe(
    [
      "docs/auth.md#login-spec (linked from src/auth/login.ts#login)",
      "",
      "## Login Spec",
      "",
      "The login flow.",
      "",
      "---",
      "",
      "src/auth/login.ts#login (linked from docs/auth.md#login-spec)",
      "",
      "```ts",
      "/**",
      " * @doc docs/auth.md#login-spec",
      " */",
      "export function login() {}",
      "```",
      "",
      "2 input files, 2 context blocks",
    ].join("\n"),
  );
});

test("formatContextResult lengthens the code fence beyond backtick runs in the content", () => {
  const result = {
    contexts: [
      {
        endpoint: "src/a.ts#example",
        kind: "code" as const,
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 2,
        linkedFrom: ["docs/a.md#a-spec"],
        content: '/** @doc docs/a.md#a-spec */\nexport const example = " ``` ";',
      },
    ],
    summary: { inputFiles: 1, contexts: 1 },
    diagnostics: [],
  };

  expect(formatContextResult(result)).toBe(
    [
      "src/a.ts#example (linked from docs/a.md#a-spec)",
      "",
      "````ts",
      "/** @doc docs/a.md#a-spec */",
      'export const example = " ``` ";',
      "````",
      "",
      "1 input file, 1 context block",
    ].join("\n"),
  );
});

test("formatContextResult prints only the summary when there are no blocks", () => {
  const result = {
    ...computeContext(graphFrom(BASIC), contentMap(BASIC), ["bun.lock"]),
    diagnostics: [],
  };

  expect(formatContextResult(result)).toBe("1 input file, 0 context blocks");
});

test("computeContext dedents a member declaration to its own indentation level", () => {
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

test("computeContext leaves a top-level declaration unchanged", () => {
  const result = computeContext(graphFrom(BASIC), contentMap(BASIC), ["docs/auth.md"]);

  expect(result.contexts[0]?.content).toBe(LOGIN_TS.trimEnd());
});

test("computeContext keeps the indentation of a top-level declaration whose lines are all indented", () => {
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
