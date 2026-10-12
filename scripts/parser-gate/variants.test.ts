import { describe, expect, test } from "bun:test";

import {
  INJECTED_TARGET,
  type ReportedSymbol,
  hashNumber,
  injectAnnotation,
  malformedVariants,
  selectMalformedFiles,
  sha256Hex,
} from "./variants";

function symbol(canonicalId: string, line: number, column = 1): ReportedSymbol {
  return { canonicalId, endpoint: `E:${canonicalId}`, location: { line, column } };
}

describe("hashNumber", () => {
  test("is the first 12 hex digits of the SHA-256 as an integer", () => {
    const hex = sha256Hex("abc");
    expect(hex.slice(0, 12)).toBe("ba7816bf8f01");
    expect(hashNumber("abc")).toBe(0xba7816bf8f01);
  });
});

describe("injectAnnotation", () => {
  test("inserts the annotation line before the name line and describes the expected link", () => {
    const content = "struct A {\n    func f() {}\n}\n";
    const injection = injectAnnotation(content, {
      symbols: [],
      undocumentedSymbols: [symbol("A.f()", 2, 10)],
    });
    expect(injection).toEqual({
      content: `struct A {\n    /// @doc ${INJECTED_TARGET}\n    func f() {}\n}\n`,
      canonicalId: "A.f()",
      expected: {
        source: "E:A.f()",
        target: INJECTED_TARGET,
        // 4 spaces of indent + "/// @doc " (9 units) + 1.
        location: { line: 2, column: 14 },
      },
    });
  });

  test("counts the column in UTF-16 units of the indent, tabs included", () => {
    const content = "class A {\n\t\tvar x = 1\n}\n";
    const injection = injectAnnotation(content, {
      symbols: [],
      undocumentedSymbols: [symbol("A.x", 2, 7)],
    });
    expect(injection?.content).toBe(
      `class A {\n\t\t/// @doc ${INJECTED_TARGET}\n\t\tvar x = 1\n}\n`,
    );
    expect(injection?.expected.location).toEqual({ line: 2, column: 2 + 9 + 1 });
  });

  test("uses CRLF when the name line ends with CRLF", () => {
    const content = "struct A {\r\n  func f() {}\r\n}\r\n";
    const injection = injectAnnotation(content, {
      symbols: [],
      undocumentedSymbols: [symbol("A.f()", 2, 8)],
    });
    expect(injection?.content).toBe(
      `struct A {\r\n  /// @doc ${INJECTED_TARGET}\r\n  func f() {}\r\n}\r\n`,
    );
  });

  test("accepts a symbol on the first line", () => {
    const injection = injectAnnotation("func f() {}\n", {
      symbols: [],
      undocumentedSymbols: [symbol("f()", 1, 6)],
    });
    expect(injection?.content).toBe(`/// @doc ${INJECTED_TARGET}\nfunc f() {}\n`);
    expect(injection?.expected.location).toEqual({ line: 1, column: 10 });
  });

  test("accepts a previous line that is blank or only whitespace", () => {
    const content = "let a = 1\n\n  \nfunc f() {}\n";
    const injection = injectAnnotation(content, {
      symbols: [symbol("a", 1, 5)],
      undocumentedSymbols: [symbol("f()", 4, 6)],
    });
    expect(injection?.canonicalId).toBe("f()");
  });

  test("accepts a previous line ending in an opening brace followed by whitespace", () => {
    const content = "struct A {  \n  func f() {}\n}\n";
    const injection = injectAnnotation(content, {
      symbols: [],
      undocumentedSymbols: [symbol("A.f()", 2, 8)],
    });
    expect(injection?.canonicalId).toBe("A.f()");
  });

  test("rejects a symbol whose previous line is code", () => {
    const content = "let a = 1\nfunc f() {}\n";
    expect(
      injectAnnotation(content, { symbols: [], undocumentedSymbols: [symbol("f()", 2, 6)] }),
    ).toBeUndefined();
  });

  test("rejects a symbol whose previous line is a comment or attribute", () => {
    const content = "@objc\nfunc f() {}\n";
    expect(
      injectAnnotation(content, { symbols: [], undocumentedSymbols: [symbol("f()", 2, 6)] }),
    ).toBeUndefined();
  });

  test("rejects a symbol whose line holds another reported symbol", () => {
    const content = "struct A {\n  var x = 1, y = 2\n}\n";
    expect(
      injectAnnotation(content, {
        symbols: [symbol("A.y", 2, 14)],
        undocumentedSymbols: [symbol("A.x", 2, 7)],
      }),
    ).toBeUndefined();
  });

  test("treats a symbol reported in both lists as one symbol", () => {
    const content = "func f() {}\n";
    const same = symbol("f()", 1, 6);
    expect(
      injectAnnotation(content, { symbols: [same], undocumentedSymbols: [same] }),
    ).toBeDefined();
  });

  test("picks the candidate with the smallest canonicalId hash", () => {
    const content = "struct A {\n  func f() {}\n\n  func g() {}\n  func h() {}\n}\n";
    const f = symbol("A.f()", 2, 8);
    const g = symbol("A.g()", 4, 8);
    const injection = injectAnnotation(content, { symbols: [], undocumentedSymbols: [f, g] });
    const expected = [f, g].toSorted((a, b) =>
      sha256Hex(a.canonicalId).localeCompare(sha256Hex(b.canonicalId)),
    )[0];
    expect(injection?.canonicalId).toBe(expected?.canonicalId);
  });

  test("has no candidate for a file without undocumented symbols", () => {
    expect(
      injectAnnotation("let a = 1\n", { symbols: [symbol("a", 1, 5)], undocumentedSymbols: [] }),
    ).toBeUndefined();
  });

  test("ignores documented symbols as candidates", () => {
    expect(
      injectAnnotation("func f() {}\n", {
        symbols: [symbol("f()", 1, 6)],
        undocumentedSymbols: [],
      }),
    ).toBeUndefined();
  });

  test("handles a name line without a final newline", () => {
    const injection = injectAnnotation("struct A {\r\n  var x = 1", {
      symbols: [],
      undocumentedSymbols: [symbol("A.x", 2, 7)],
    });
    expect(injection?.content).toBe(`struct A {\r\n  /// @doc ${INJECTED_TARGET}\r\n  var x = 1`);
  });
});

describe("selectMalformedFiles", () => {
  test("keeps the smallest repository/path hashes", () => {
    const files = ["a", "b", "c", "d"].map((path) => ({ repository: "o/n", path }));
    const selected = selectMalformedFiles(files, 2);
    const expected = files
      .toSorted((x, y) =>
        sha256Hex(`${x.repository}/${x.path}`).localeCompare(
          sha256Hex(`${y.repository}/${y.path}`),
        ),
      )
      .slice(0, 2);
    expect(selected).toEqual(expected);
  });

  test("keeps every file when there are fewer than the limit", () => {
    const files = [{ repository: "o/n", path: "a" }];
    expect(selectMalformedFiles(files, 500)).toEqual(files);
  });
});

const key = (name: string) => `o/n/a.swift:${name}`;

describe("malformedVariants", () => {
  test("deletes the brace selected by the key hash", () => {
    const content = "a { b } c { d }";
    const result = malformedVariants(content, "o/n/a.swift").find((v) => v.name === "delete-brace");
    const braces = [...content].flatMap((char, index) => (char === "}" ? [index] : []));
    const target = braces[hashNumber(key("delete-brace")) % braces.length] ?? -1;
    expect(result?.content).toBe(content.slice(0, target) + content.slice(target + 1));
  });

  test("makes no delete-brace variant when there is no brace", () => {
    const names = malformedVariants("let a = 1\nlet b = 2\n", "p").map((v) => v.name);
    expect(names).not.toContain("delete-brace");
    expect(names).toContain("insert-paren");
    expect(names).toContain("truncate");
  });

  test("inserts the paren by code point, not UTF-16 unit", () => {
    const content = "😀😀😀😀😀 x";
    const points = [...content];
    const result = malformedVariants(content, "p").find((v) => v.name === "insert-paren");
    const at = hashNumber("p:insert-paren") % (points.length + 1);
    expect(result?.content).toBe(`${points.slice(0, at).join("")}(${points.slice(at).join("")}`);
    // No lone surrogate is created.
    expect(result?.content.isWellFormed()).toBe(true);
  });

  test("inserts the paren into empty content", () => {
    const result = malformedVariants("", "p").find((v) => v.name === "insert-paren");
    expect(result?.content).toBe("(");
  });

  test("truncates after the selected line and keeps its newline", () => {
    const content = "l1\nl2\nl3\nl4\n";
    const result = malformedVariants(content, "p").find((v) => v.name === "truncate");
    const keep = 1 + (hashNumber("p:truncate") % 3);
    expect(result?.content).toBe(`${content.split("\n").slice(0, keep).join("\n")}\n`);
    expect(result?.content.length).toBeLessThan(content.length);
  });

  test("counts a final line without newline as a line", () => {
    const result = malformedVariants("l1\nl2", "p").find((v) => v.name === "truncate");
    expect(result?.content).toBe("l1\n");
  });

  test("makes no truncate variant for a one-line file", () => {
    expect(malformedVariants("let a = 1\n", "p").map((v) => v.name)).not.toContain("truncate");
    expect(malformedVariants("let a = 1", "p").map((v) => v.name)).not.toContain("truncate");
  });

  test("handles non-ASCII content in delete-brace", () => {
    const content = "// 日本語 }\nfunc f() { }\n";
    const result = malformedVariants(content, "p").find((v) => v.name === "delete-brace");
    expect(result?.content.length).toBe(content.length - 1);
    expect(result?.content.split("}").length).toBe(content.split("}").length - 1);
  });
});
