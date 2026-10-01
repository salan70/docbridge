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

test("an annotated interface in a .js file is a code_parse_error with no endpoint or link", () => {
  const result = scanTypeScript(
    "src/a.js",
    "/** @doc docs/a.md#x */ export interface X { a: number; }\n",
  );

  expect(result.symbols).toEqual([]);
  expect(result.undocumentedSymbols).toEqual([]);
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      severity: "error",
      code: "code_parse_error",
      language: "javascript",
      target: "src/a.js",
      message:
        "JavaScript parse error: 'interface' declarations can only be used in TypeScript files.",
      location: { filePath: "src/a.js", line: 1, column: 42 },
    },
  ]);
});

test.each([
  ["a type alias", "export type Id = string;\n", { line: 1, column: 13 }],
  ["a type annotation", "export function login(email: string) {}\n", { line: 1, column: 30 }],
  ["an enum", "export enum Role { Admin }\n", { line: 1, column: 13 }],
  ["an implements clause", "export class A implements B {}\n", { line: 1, column: 16 }],
])("%s in a .js file is a JavaScript code_parse_error at the construct", (_label, content, at) => {
  const result = scanTypeScript(
    "src/a.js",
    `${content}/** @doc docs/a.md#b */\nexport const b = 1;\n`,
  );

  expect(result.symbols).toEqual([]);
  expect(result.links).toEqual([]);
  expect(result.diagnostics).toMatchObject([
    {
      code: "code_parse_error",
      language: "javascript",
      message: expect.stringMatching(
        /^JavaScript parse error: .* only be used in TypeScript files/,
      ),
      location: { filePath: "src/a.js", ...at },
    },
  ]);
});

test.each(["src/a.jsx", "src/a.mjs", "src/a.cjs"])(
  "TypeScript-only syntax in %s is a code_parse_error too",
  (filePath) => {
    const result = scanTypeScript(filePath, "export interface X {}\n");

    expect(result.diagnostics.map(({ code, language }) => [code, language])).toEqual([
      ["code_parse_error", "javascript"],
    ]);
  },
);

test("a parser error wins over TypeScript-only syntax in the same JavaScript file", () => {
  const result = scanTypeScript("src/a.js", "export interface X {}\nexport function f( {\n");

  expect(result.diagnostics).toMatchObject([
    { code: "code_parse_error", message: "JavaScript parse error: '}' expected." },
  ]);
});

test("JSDoc types in a .js file stay comments, not TypeScript syntax", () => {
  const content = [
    "/** @typedef {{ id: string, roles: Array<'admin' | 'user'> }} User */",
    "",
    "/**",
    " * @doc docs/a.md#login",
    " * @template T",
    " * @param {string} email",
    " * @param {import('./session.js').Options<T>} [options]",
    " * @returns {Promise<User | undefined>}",
    " */",
    "export async function login(email, options) {",
    "  return /** @type {User} */ (await fetch(email));",
    "}",
    "",
  ].join("\n");

  const result = scanTypeScript("src/a.js", content);

  expect(result.diagnostics).toEqual([]);
  expect(result.symbols.map((symbol) => symbol.endpoint)).toEqual(["src/a.js#login"]);
});

test("the same TypeScript-only syntax in a .ts file stays valid", () => {
  const result = scanTypeScript(
    "src/a.ts",
    "/** @doc docs/a.md#x */ export interface X { a: number; }\n",
  );

  expect(result.diagnostics).toEqual([]);
  expect(result.symbols.map((symbol) => symbol.endpoint)).toEqual(["src/a.ts#X"]);
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

const REPEATED_AND_INVALID_LINKS = [
  "/**",
  " * @doc docs/a.md#login",
  " * @doc docs/a.md#login",
  " * @doc not-a-target",
  " */",
  "export function login() {}",
  "",
].join("\n");

test("duplicate_link and invalid_link_target from a JavaScript file carry language javascript", () => {
  const result = scanTypeScript("src/a.js", REPEATED_AND_INVALID_LINKS);

  expect(result.diagnostics.map(({ code, language }) => [code, language])).toEqual([
    ["duplicate_link", "javascript"],
    ["invalid_link_target", "javascript"],
  ]);
});

test("duplicate_link and invalid_link_target from a TypeScript file still carry no language", () => {
  const result = scanTypeScript("src/a.ts", REPEATED_AND_INVALID_LINKS);

  expect(result.diagnostics.map(({ code, language }) => [code, language])).toEqual([
    ["duplicate_link", undefined],
    ["invalid_link_target", undefined],
  ]);
});
