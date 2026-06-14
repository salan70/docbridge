import { describe, expect, test } from "bun:test";

import type { CodeSymbolEndpoint, DocLinkAnnotation } from "./types";
import { scanTypeScript } from "./typescript";

const FILE = "src/auth/login.ts";

function scan(content: string, filePath = FILE) {
  return scanTypeScript(filePath, content);
}

describe("scanTypeScript", () => {
  test("returns the scanned file path", () => {
    const result = scan("export const value = 1;\n");

    expect(result.filePath).toBe(FILE);
  });

  test("ignores files without @doc annotations", () => {
    const result = scan("export function login() {}\n");

    expect(result.symbols).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  describe("supported declarations with @doc", () => {
    const cases: Array<[string, string, string]> = [
      [
        "exported function",
        "export function login() {}",
        "login",
      ],
      [
        "exported async function",
        "export async function login() { return { ok: true }; }",
        "login",
      ],
      ["exported class", "export class Login {}", "Login"],
      ["exported abstract class", "export abstract class Login {}", "Login"],
      ["exported interface", "export interface Login {}", "Login"],
      ["exported type alias", "export type Login = string;", "Login"],
      ["exported const single declarator", "export const login = 1;", "login"],
      ["exported enum", "export enum Login { A }", "Login"],
      ["exported const enum", "export const enum Login { A }", "Login"],
      [
        "named default function",
        "export default function login() {}",
        "login",
      ],
      ["named default class", "export default class Login {}", "Login"],
      ["declare function", "export declare function login(): void;", "login"],
      ["declare const", "export declare const login: number;", "login"],
    ];

    test.each(cases)(
      "extracts one code symbol and one code->doc link from %s",
      (_label, declaration, symbolName) => {
        const content = `/**\n * @doc docs/auth.md#login-spec\n */\n${declaration}\n`;
        const result = scan(content);

        const expectedSymbol: CodeSymbolEndpoint = {
          kind: "code",
          filePath: FILE,
          symbolName,
          endpoint: `${FILE}#${symbolName}`,
          location: expect.objectContaining({
            filePath: FILE,
            line: expect.any(Number),
            column: expect.any(Number),
          }) as unknown as CodeSymbolEndpoint["location"],
        };

        expect(result.symbols).toMatchObject([expectedSymbol]);

        const expectedLink: DocLinkAnnotation = {
          direction: "code-to-doc",
          source: `${FILE}#${symbolName}`,
          target: "docs/auth.md#login-spec",
          location: expect.objectContaining({
            filePath: FILE,
          }) as unknown as DocLinkAnnotation["location"],
        };

        expect(result.links).toMatchObject([expectedLink]);
        expect(result.diagnostics).toEqual([]);
      },
    );
  });

  test("uses 1-based declaration location for symbol and link", () => {
    const content = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
    const result = scan(content);

    expect(result.symbols[0]?.location).toEqual({
      filePath: FILE,
      line: 4,
      column: 1,
    });
    expect(result.links[0]?.location).toEqual({
      filePath: FILE,
      line: 4,
      column: 1,
    });
  });

  test("takes the first whitespace-delimited token as the target", () => {
    const content =
      "/**\n * @doc docs/auth.md#login-spec Human readable note\n */\nexport function login() {}\n";
    const result = scan(content);

    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.target).toBe("docs/auth.md#login-spec");
  });

  test("supports multiple @doc tags on one declaration", () => {
    const content =
      "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#logout-spec\n */\nexport function login() {}\n";
    const result = scan(content);

    expect(result.symbols).toHaveLength(1);
    expect(result.links.map((link) => link.target)).toEqual([
      "docs/auth.md#login-spec",
      "docs/auth.md#logout-spec",
    ]);
  });

  describe("unsupported declarations", () => {
    const unsupported: Array<[string, string]> = [
      ["anonymous default export", "export default function () {}"],
      ["anonymous default class", "export default class {}"],
      ["multi-declarator const", "export const a = 1, b = 2;"],
      ["namespace declaration", "export namespace Login {}"],
      ["module declaration", 'declare module "login" {}'],
      ["non-exported declaration", "function login() {}"],
    ];

    test.each(unsupported)(
      "emits unsupported_declaration warning for %s with @doc",
      (_label, declaration) => {
        const content = `/**\n * @doc docs/auth.md#login-spec\n */\n${declaration}\n`;
        const result = scan(content);

        expect(result.symbols).toEqual([]);
        expect(result.links).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.severity).toBe("warning");
        expect(result.diagnostics[0]?.code).toBe("unsupported_declaration");
        expect(result.diagnostics[0]?.location?.filePath).toBe(FILE);
      },
    );

    test("ignores unsupported declarations without @doc", () => {
      const result = scan("export const a = 1, b = 2;\nexport namespace N {}\n");

      expect(result.symbols).toEqual([]);
      expect(result.links).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("re-exports with @doc", () => {
    test("emits unsupported_declaration for a value re-export", () => {
      const content =
        '/**\n * @doc docs/auth.md#login-spec\n */\nexport { login } from "./other";\n';
      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("unsupported_declaration");
    });

    test("emits unsupported_declaration for a type-only re-export", () => {
      const content =
        '/**\n * @doc docs/auth.md#login-spec\n */\nexport type { Login } from "./other";\n';
      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("unsupported_declaration");
    });
  });

  test("emits duplicate_code_symbol when two supported declarations expose the same endpoint", () => {
    const content =
      "/**\n * @doc docs/auth.md#a\n */\nexport function login() {}\n/**\n * @doc docs/auth.md#b\n */\nexport class login {}\n";
    const result = scan(content);

    const duplicate = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "duplicate_code_symbol",
    );
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe("error");
    expect(duplicate[0]?.target).toBe(`${FILE}#login`);
  });

  test("emits duplicate_link for the same code endpoint to the same doc endpoint", () => {
    const content =
      "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
    const result = scan(content);

    const duplicate = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "duplicate_link",
    );
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.severity).toBe("warning");
    expect(duplicate[0]?.source).toBe(`${FILE}#login`);
    expect(duplicate[0]?.target).toBe("docs/auth.md#login-spec");

    // Only one link is kept.
    expect(result.links).toHaveLength(1);
  });

  test("emits invalid_link_target for malformed @doc targets", () => {
    const content =
      "/**\n * @doc not-a-valid-target\n */\nexport function login() {}\n";
    const result = scan(content);

    const invalid = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "invalid_link_target",
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.severity).toBe("error");
    expect(invalid[0]?.source).toBe(`${FILE}#login`);
    expect(invalid[0]?.location?.filePath).toBe(FILE);

    // No link is produced for an invalid target, but the symbol still exists.
    expect(result.links).toEqual([]);
    expect(result.symbols).toHaveLength(1);
  });

  describe("parse errors", () => {
    test("emits typescript_parse_error and extracts nothing on syntactic errors", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login( {\n";
      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.links).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("typescript_parse_error");
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.location?.filePath).toBe(FILE);
    });
  });

  describe("undocumented supported declarations", () => {
    test("surfaces a supported exported declaration without @doc", () => {
      const result = scan("export function login() {}\n");

      expect(result.symbols).toEqual([]);
      expect(result.links).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.undocumentedSymbols).toMatchObject([
        {
          kind: "code",
          filePath: FILE,
          symbolName: "login",
          endpoint: `${FILE}#login`,
          location: { filePath: FILE, line: 1, column: 1 },
        },
      ]);
    });

    test("does not surface unsupported declarations without @doc", () => {
      const result = scan("export const a = 1, b = 2;\nexport namespace N {}\n");

      expect(result.undocumentedSymbols).toEqual([]);
    });

    test("does not surface non-exported declarations", () => {
      const result = scan("function login() {}\n");

      expect(result.undocumentedSymbols).toEqual([]);
    });

    test("treats an endpoint as documented when any declaration has @doc", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
      const result = scan(content);

      expect(result.symbols).toHaveLength(1);
      expect(result.undocumentedSymbols).toEqual([]);
    });

    test("reports each undocumented endpoint in a mixed file", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\nexport function logout() {}\n";
      const result = scan(content);

      expect(result.symbols.map((symbol) => symbol.symbolName)).toEqual([
        "login",
      ]);
      expect(
        result.undocumentedSymbols.map((symbol) => symbol.symbolName),
      ).toEqual(["logout"]);
    });
  });

  test("matches the examples/basic login fixture: one symbol and one link", () => {
    const content =
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport async function login() {\n  return { ok: true };\n}\n";
    const result = scanTypeScript("src/auth/login.ts", content);

    expect(result.diagnostics).toEqual([]);
    expect(result.symbols).toMatchObject([
      {
        kind: "code",
        filePath: "src/auth/login.ts",
        symbolName: "login",
        endpoint: "src/auth/login.ts#login",
        location: { filePath: "src/auth/login.ts", line: 4, column: 1 },
      },
    ]);
    expect(result.links).toMatchObject([
      {
        direction: "code-to-doc",
        source: "src/auth/login.ts#login",
        target: "docs/auth.md#login-spec",
        location: { filePath: "src/auth/login.ts", line: 4, column: 1 },
      },
    ]);
  });

  describe("ranges", () => {
    test("records the name identifier range, not the declaration start", () => {
      const content = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
      const result = scan(content);

      // `login` begins at column 17 on line 4 (`export function ` is 16 chars).
      expect(result.symbols[0]?.nameRange).toEqual({
        start: { line: 4, column: 17 },
        end: { line: 4, column: 22 },
      });
    });

    test("records the @doc target string range inside the JSDoc", () => {
      const content = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
      const result = scan(content);

      // ` * @doc ` is 8 chars; the target starts at column 9 on line 2.
      const target = "docs/auth.md#login-spec";
      expect(result.links[0]?.targetRange).toEqual({
        start: { line: 2, column: 9 },
        end: { line: 2, column: 9 + target.length },
      });
    });

    test("attaches the target range to invalid_link_target diagnostics", () => {
      const content = "/**\n * @doc not-a-valid-target\n */\nexport function login() {}\n";
      const result = scan(content);

      const diagnostic = result.diagnostics.find(
        (entry) => entry.code === "invalid_link_target",
      );
      expect(diagnostic?.range).toEqual({
        start: { line: 2, column: 9 },
        end: { line: 2, column: 9 + "not-a-valid-target".length },
      });
    });

    test("records the full declaration range including the JSDoc block", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {\n  return true;\n}\n";
      const result = scan(content);

      expect(result.symbols[0]?.declarationRange).toEqual({
        start: { line: 1, column: 1 },
        end: { line: 6, column: 2 },
      });
    });

    test("records the signature range including JSDoc but excluding the function body", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {\n  return true;\n}\n";
      const result = scan(content);

      expect(result.symbols[0]?.signatureRange).toEqual({
        start: { line: 1, column: 1 },
        end: { line: 4, column: 25 },
      });
    });

    test("records the class signature range without truncating object-shaped type parameters", () => {
      const content =
        "/**\n * @doc docs/auth.md#widget-spec\n */\nexport class Widget<T extends { y: number }> extends Base {\n  value = 1;\n}\n";
      const result = scan(content);

      expect(result.symbols[0]?.signatureRange).toEqual({
        start: { line: 1, column: 1 },
        end: { line: 4, column: 59 },
      });
    });

    test("records const arrow function signature range excluding the initializer body", () => {
      const content =
        "/**\n * @doc docs/auth.md#login-spec\n */\nexport const login = <T extends { ok: boolean }>() => {\n  return true;\n};\n";
      const result = scan(content);

      expect(result.symbols[0]?.signatureRange).toEqual({
        start: { line: 1, column: 1 },
        end: { line: 4, column: 55 },
      });
    });

    test("records const object signature range excluding the initializer body", () => {
      const content =
        "/**\n * @doc docs/auth.md#config-spec\n */\nexport const config = {\n  enabled: true,\n};\n";
      const result = scan(content);

      expect(result.symbols[0]?.signatureRange).toEqual({
        start: { line: 1, column: 1 },
        end: { line: 4, column: 23 },
      });
    });

    test("records the declaration range of an annotated exported const including its JSDoc", () => {
      const content =
        "import x from \"./x\";\n\n/**\n * @doc docs/auth.md#token-spec\n */\nexport const token = \"abc\";\n";
      const result = scan(content);

      expect(result.symbols[0]?.declarationRange).toEqual({
        start: { line: 3, column: 1 },
        end: { line: 6, column: 28 },
      });
    });
  });
});
