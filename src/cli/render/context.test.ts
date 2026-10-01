import { expect, test } from "bun:test";

import type { CodeLanguage } from "../../model/types";
import { computeContext } from "../../query/context";
import { graphFrom, type GraphSources } from "../../test-support";
import { formatContextResult } from "./context";

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

/** A one-line code context block for a declaration in `filePath`. */
function codeBlock(filePath: string, language: CodeLanguage) {
  return {
    endpoint: `${filePath}#Login`,
    kind: "code" as const,
    filePath,
    language,
    startLine: 1,
    endLine: 1,
    linkedFrom: ["docs/a.md#login"],
    content: "export function Login() {}",
  };
}

test("formatContextResult fences a TypeScript declaration by its file suffix", () => {
  const result = {
    contexts: [codeBlock("src/login.tsx", "typescript"), codeBlock("src/login.mts", "typescript")],
    summary: { inputFiles: 1, contexts: 2 },
    diagnostics: [],
  };

  const fences = formatContextResult(result)
    .split("\n")
    .filter((line) => line.startsWith("```") && line.length > 3);

  expect(fences).toEqual(["```tsx", "```ts"]);
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
