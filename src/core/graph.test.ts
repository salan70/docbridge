import { describe, expect, test } from "bun:test";

import { buildLinkGraph, counterpartsOf, endpointObject } from "./graph";
import { computeGraphResult } from "./graph-output";
import { scanMarkdown } from "./markdown";
import { scanTypeScript } from "./typescript";

const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

function graphOf(code: string, doc: string) {
  const codeScan = scanTypeScript(CODE_FILE, code);
  const docScan = scanMarkdown(DOC_FILE, doc);
  return buildLinkGraph([codeScan], [docScan]);
}

describe("buildLinkGraph", () => {
  test("links a code symbol and a doc anchor through a resolvable pair", () => {
    const graph = graphOf(
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
      "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n",
    );

    expect(counterpartsOf(graph, `${CODE_FILE}#login`).map((e) => e.endpoint)).toEqual([
      `${DOC_FILE}#login-spec`,
    ]);
    expect(counterpartsOf(graph, `${DOC_FILE}#login-spec`).map((e) => e.endpoint)).toEqual([
      `${CODE_FILE}#login`,
    ]);
  });

  test("honors a resolvable one-way @doc link with no @code backlink", () => {
    const graph = graphOf(
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
      "## Login Spec\n",
    );

    // Navigable in both directions because the @doc target resolves, even
    // though the reverse @code backlink is missing.
    expect(counterpartsOf(graph, `${CODE_FILE}#login`).map((e) => e.endpoint)).toEqual([
      `${DOC_FILE}#login-spec`,
    ]);
    expect(counterpartsOf(graph, `${DOC_FILE}#login-spec`).map((e) => e.endpoint)).toEqual([
      `${CODE_FILE}#login`,
    ]);
  });

  test("creates no edge when the @doc target anchor does not exist", () => {
    const graph = graphOf(
      "/**\n * @doc docs/auth.md#missing\n */\nexport function login() {}\n",
      "## Login Spec\n",
    );

    expect(counterpartsOf(graph, `${CODE_FILE}#login`)).toEqual([]);
  });

  test("returns multiple doc counterparts for a one-to-many code symbol", () => {
    const graph = graphOf(
      "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#flow\n */\nexport function login() {}\n",
      "## Login Spec\n\n## Flow\n",
    );

    // Ordered by document location: login-spec (line 1) before flow (line 3).
    expect(counterpartsOf(graph, `${CODE_FILE}#login`).map((e) => e.endpoint)).toEqual([
      `${DOC_FILE}#login-spec`,
      `${DOC_FILE}#flow`,
    ]);
  });

  test("returns every code symbol that links to a shared doc anchor", () => {
    const code = [
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function relogin() {}\n",
    ].join("\n");
    const graph = graphOf(code, "## Login Spec\n");

    expect(counterpartsOf(graph, `${DOC_FILE}#login-spec`).map((e) => e.endpoint)).toEqual([
      `${CODE_FILE}#login`,
      `${CODE_FILE}#relogin`,
    ]);
  });

  test("endpointObject resolves recorded code and doc endpoints", () => {
    const graph = graphOf(
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
      "## Login Spec\n",
    );

    expect(endpointObject(graph, `${CODE_FILE}#login`)?.kind).toBe("code");
    expect(endpointObject(graph, `${DOC_FILE}#login-spec`)?.kind).toBe("doc");
    expect(endpointObject(graph, "nope#x")).toBeUndefined();
  });

  test("graph output and navigation choose the first duplicated code endpoint", () => {
    const firstCode = ["/** @doc docs/auth.md#login-spec */", "export const login = 1;", ""].join(
      "\n",
    );
    const secondCode = [
      "",
      "",
      "/** @doc docs/auth.md#login-spec */",
      "export const login = 2;",
      "",
    ].join("\n");
    const doc = "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n";
    const firstCodeScan = scanTypeScript(CODE_FILE, firstCode);
    const secondCodeScan = scanTypeScript(CODE_FILE, secondCode);
    const docScan = scanMarkdown(DOC_FILE, doc);
    const graph = buildLinkGraph([firstCodeScan, secondCodeScan], [docScan]);

    const navigationTarget = counterpartsOf(graph, `${DOC_FILE}#login-spec`)[0];
    const result = computeGraphResult({
      codeFiles: [firstCodeScan, secondCodeScan],
      docFiles: [docScan],
      diagnostics: [],
      contentByFile: new Map([
        [CODE_FILE, firstCode],
        [DOC_FILE, doc],
      ]),
      inputFiles: [],
      includeContent: false,
    });
    const outputTarget = result.nodes.find((node) => node.endpoint === `${CODE_FILE}#login`);

    expect(navigationTarget?.location.line).toBe(2);
    expect(outputTarget?.location).toEqual(navigationTarget?.location);
  });
});
