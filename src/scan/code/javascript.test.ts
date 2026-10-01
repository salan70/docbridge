import { expect, test } from "bun:test";

import { javaScriptAdapter, scanTypeScript } from "./typescript";

const LOGIN = "/** @doc docs/auth.md#login */\nexport function login(email, password) {}\n";

test.each(["src/auth.js", "src/auth.jsx", "src/auth.mjs", "src/auth.cjs"])(
  "%s scans as javascript with TypeScript's JSDoc attachment",
  (filePath) => {
    const result = scanTypeScript(filePath, LOGIN);

    expect(result.language).toBe("javascript");
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols).toEqual([
      {
        kind: "code",
        language: "javascript",
        filePath,
        symbolName: "login",
        canonicalId: "login",
        endpoint: `${filePath}#login`,
        location: { filePath, line: 2, column: 17 },
        nameRange: { start: { line: 2, column: 17 }, end: { line: 2, column: 22 } },
        declarationRange: { start: { line: 1, column: 1 }, end: { line: 2, column: 42 } },
        signatureRange: { start: { line: 1, column: 1 }, end: { line: 2, column: 40 } },
      },
    ]);
    expect(result.links).toEqual([
      {
        source: `${filePath}#login`,
        target: "docs/auth.md#login",
        location: { filePath, line: 1, column: 10 },
        targetRange: { start: { line: 1, column: 10 }, end: { line: 1, column: 28 } },
      },
    ]);
  },
);

test("the javascript adapter scans every file of a batch in process", () => {
  const scans = javaScriptAdapter.scanFiles(
    [
      { filePath: "src/a.js", content: LOGIN },
      { filePath: "src/b.mjs", content: "export const b = 1;\n" },
    ],
    {},
    { projectRoot: "/project" },
  );

  expect(javaScriptAdapter.language).toBe("javascript");
  expect(scans.map((scan) => [scan.language, scan.filePath])).toEqual([
    ["javascript", "src/a.js"],
    ["javascript", "src/b.mjs"],
  ]);
  expect(scans[1]?.undocumentedSymbols.map((symbol) => symbol.endpoint)).toEqual(["src/b.mjs#b"]);
});

test.each(["src/view.jsx", "src/view.js"])("%s parses JSX inside a declaration", (filePath) => {
  const result = scanTypeScript(
    filePath,
    '/** @doc docs/ui.md#view */\nexport const View = () => <div className="view" />;\n',
  );

  expect(result.diagnostics).toEqual([]);
  expect(result.symbols.map((symbol) => symbol.endpoint)).toEqual([`${filePath}#View`]);
});

test("class members of an exported JavaScript class are public endpoints", () => {
  const content = [
    "export class AuthService {",
    "  /** @doc docs/auth.md#timeout */",
    "  timeout = 30;",
    "",
    "  /** @doc docs/auth.md#login */",
    "  login(email) {}",
    "",
    "  /** @doc docs/auth.md#create */",
    "  static create() {}",
    "}",
    "",
  ].join("\n");

  const result = scanTypeScript("src/service.js", content);

  expect(result.diagnostics).toEqual([]);
  expect(result.symbols.map((symbol) => [symbol.canonicalId, symbol.isMember])).toEqual([
    ["AuthService.timeout", true],
    ["AuthService.login", true],
    ["AuthService.create", true],
  ]);
});

test("a JavaScript member is public, so a public-free visibility excludes it", () => {
  const content = "export class A {\n  /** @doc docs/a.md#run */\n  run() {}\n}\n";

  const result = scanTypeScript("src/a.js", content, { visibility: ["protected", "private"] });

  expect(result.symbols.map((symbol) => symbol.canonicalId)).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "unsupported_declaration",
  ]);
});

test("an annotated #private member is unsupported_declaration with language javascript", () => {
  const content = "export class A {\n  /** @doc docs/a.md#secret */\n  #secret() {}\n}\n";

  const result = scanTypeScript("src/a.js", content);

  expect(result.symbols).toEqual([]);
  expect(result.diagnostics).toMatchObject([
    {
      severity: "warning",
      code: "unsupported_declaration",
      language: "javascript",
      target: "src/a.js",
      location: { filePath: "src/a.js", line: 3, column: 3 },
    },
  ]);
});

test.each([
  ["module.exports", "/** @doc docs/a.md#login */\nmodule.exports = function login() {};\n"],
  ["exports.name", "/** @doc docs/a.md#login */\nexports.login = function login() {};\n"],
])("an annotated CommonJS %s assignment is unsupported_declaration", (_label, content) => {
  const result = scanTypeScript("src/a.cjs", content);

  expect(result.symbols).toEqual([]);
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toMatchObject([
    {
      code: "unsupported_declaration",
      language: "javascript",
      location: { filePath: "src/a.cjs", line: 2, column: 1 },
    },
  ]);
});

test("a JavaScript syntax error is a JavaScript code_parse_error", () => {
  const result = scanTypeScript("src/a.js", "export function login( {\n");

  expect(result.symbols).toEqual([]);
  expect(result.diagnostics).toMatchObject([
    {
      severity: "error",
      code: "code_parse_error",
      language: "javascript",
      target: "src/a.js",
      message: expect.stringMatching(/^JavaScript parse error: /),
    },
  ]);
});

test("two annotated declarations of one JavaScript endpoint are duplicate_code_symbol", () => {
  const content = [
    "export class A {",
    "  /** @doc docs/a.md#value */",
    "  get value() { return 1; }",
    "  /** @doc docs/a.md#value-setter */",
    "  set value(next) {}",
    "}",
    "",
  ].join("\n");

  const result = scanTypeScript("src/a.mjs", content);

  expect(result.diagnostics).toMatchObject([
    { code: "duplicate_code_symbol", language: "javascript", target: "src/a.mjs#A.value" },
  ]);
});
