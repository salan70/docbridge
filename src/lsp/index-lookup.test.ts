import { describe, expect, test } from "bun:test";

import { buildLinkGraph } from "../core/graph";
import { scanMarkdown } from "../core/markdown";
import { scanTypeScript } from "../core/typescript";
import { buildPositionIndex, endpointAt } from "./index-lookup";
import { fromLspPosition, rangeContains, toLspPosition, toLspRange } from "./position";

const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

describe("position conversions", () => {
  test("round-trips between LSP 0-based and DocBridge 1-based", () => {
    expect(toLspPosition({ line: 4, column: 17 })).toEqual({ line: 3, character: 16 });
    expect(fromLspPosition({ line: 3, character: 16 })).toEqual({ line: 4, column: 17 });
  });

  test("converts the document origin at the boundary", () => {
    expect(toLspPosition({ line: 1, column: 1 })).toEqual({ line: 0, character: 0 });
    expect(fromLspPosition({ line: 0, character: 0 })).toEqual({ line: 1, column: 1 });
  });

  test("converts a range end-exclusively without changing units", () => {
    expect(toLspRange({ start: { line: 1, column: 6 }, end: { line: 1, column: 11 } })).toEqual({
      start: { line: 0, character: 5 },
      end: { line: 0, character: 10 },
    });
  });
});

describe(rangeContains, () => {
  const range = { start: { line: 4, column: 17 }, end: { line: 4, column: 22 } };

  test("includes the start column and excludes the end column", () => {
    expect(rangeContains(range, { line: 4, column: 17 })).toBe(true);
    expect(rangeContains(range, { line: 4, column: 21 })).toBe(true);
    expect(rangeContains(range, { line: 4, column: 22 })).toBe(false);
    expect(rangeContains(range, { line: 4, column: 16 })).toBe(false);
  });

  test("excludes other lines", () => {
    expect(rangeContains(range, { line: 3, column: 18 })).toBe(false);
    expect(rangeContains(range, { line: 5, column: 18 })).toBe(false);
  });
});

describe(buildPositionIndex, () => {
  function indexOf(code: string, doc: string) {
    const graph = buildLinkGraph([scanTypeScript(CODE_FILE, code)], [scanMarkdown(DOC_FILE, doc)]);
    return buildPositionIndex(graph);
  }

  const CODE = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
  const DOC = "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n";

  test("resolves a position inside the declaration name", () => {
    const index = indexOf(CODE, DOC);
    // `login` spans columns 17..21 on line 4.
    const hit = endpointAt(index, CODE_FILE, { line: 4, column: 18 });
    expect(hit?.endpoint).toBe(`${CODE_FILE}#login`);
  });

  test("resolves a position inside the heading text", () => {
    const index = indexOf(CODE, DOC);
    // `Login Spec` begins at column 4 on line 2.
    const hit = endpointAt(index, DOC_FILE, { line: 2, column: 5 });
    expect(hit?.endpoint).toBe(`${DOC_FILE}#login-spec`);
  });

  test("does not resolve whitespace or the keyword portion of a declaration", () => {
    const index = indexOf(CODE, DOC);
    // Column 1 is on `export`, not the `login` name.
    expect(endpointAt(index, CODE_FILE, { line: 4, column: 1 })).toBeUndefined();
  });

  test("does not resolve the `#` marker of a heading", () => {
    const index = indexOf(CODE, DOC);
    // Column 1 is the `#` on the heading line, before the text range.
    expect(endpointAt(index, DOC_FILE, { line: 2, column: 1 })).toBeUndefined();
  });
});
