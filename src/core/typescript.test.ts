import { describe, expect, test } from "bun:test";

import type { CodeSymbolEndpoint, LinkAnnotation } from "./types";
import { scanTypeScript } from "./typescript";

const FILE = "src/auth/login.ts";

function scan(content: string, filePath = FILE) {
  return scanTypeScript(filePath, content);
}

describe("scanTypeScript", () => {
  describe("supported declarations with @doc", () => {
    const cases: Array<[string, string, string]> = [
      ["exported function", "export function login() {}", "login"],
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
      ["named default function", "export default function login() {}", "login"],
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
          language: "typescript",
          filePath: FILE,
          symbolName,
          canonicalId: symbolName,
          endpoint: `${FILE}#${symbolName}`,
          location: expect.objectContaining({
            filePath: FILE,
            line: expect.any(Number),
            column: expect.any(Number),
          }) as unknown as CodeSymbolEndpoint["location"],
        };

        expect(result.symbols).toMatchObject([expectedSymbol]);
        expect(result.language).toBe("typescript");

        const expectedLink: LinkAnnotation = {
          source: `${FILE}#${symbolName}`,
          target: "docs/auth.md#login-spec",
          location: expect.objectContaining({
            filePath: FILE,
          }) as unknown as LinkAnnotation["location"],
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
    const content = "/**\n * @doc not-a-valid-target\n */\nexport function login() {}\n";
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
    test("emits code_parse_error and extracts nothing on syntactic errors", () => {
      const content = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login( {\n";
      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.links).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("code_parse_error");
      expect(result.diagnostics[0]?.language).toBe("typescript");
      expect(result.diagnostics[0]?.severity).toBe("error");
      expect(result.diagnostics[0]?.location?.filePath).toBe(FILE);
    });
  });

  describe("undocumented supported declarations", () => {
    test("does not surface unsupported declarations without @doc", () => {
      const result = scan("export const a = 1, b = 2;\nexport namespace N {}\n");

      expect(result.undocumentedSymbols).toEqual([]);
    });

    test("does not surface non-exported declarations", () => {
      const result = scan("function login() {}\n");

      expect(result.undocumentedSymbols).toEqual([]);
    });
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

      const diagnostic = result.diagnostics.find((entry) => entry.code === "invalid_link_target");
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
        'import x from "./x";\n\n/**\n * @doc docs/auth.md#token-spec\n */\nexport const token = "abc";\n';
      const result = scan(content);

      expect(result.symbols[0]?.declarationRange).toEqual({
        start: { line: 3, column: 1 },
        end: { line: 6, column: 28 },
      });
    });
  });

  describe("type members", () => {
    test("reports undocumented members flagged as members", () => {
      const content = [
        "/**",
        " * @doc docs/auth.md#service-spec",
        " */",
        "export class AuthService {",
        "  login() {}",
        "  logout() {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(
        result.undocumentedSymbols.map(({ canonicalId, isMember }) => ({ canonicalId, isMember })),
      ).toEqual([
        { canonicalId: "AuthService.login", isMember: true },
        { canonicalId: "AuthService.logout", isMember: true },
      ]);
    });

    test("extracts a class property", () => {
      const content = [
        "export class AuthService {",
        "  /**",
        "   * @doc docs/auth.md#token-spec",
        "   */",
        '  token = "";',
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols[0]?.canonicalId).toBe("AuthService.token");
      expect(result.diagnostics).toEqual([]);
    });

    test("names the constructor after the keyword in the source", () => {
      const content = [
        "export class AuthService {",
        "  /**",
        "   * @doc docs/auth.md#construction-spec",
        "   */",
        "  constructor() {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols[0]?.canonicalId).toBe("AuthService.constructor");
      expect(result.diagnostics).toEqual([]);
    });

    test("collapses a getter and setter pair into one endpoint", () => {
      const content = [
        "export class AuthService {",
        "  /**",
        "   * @doc docs/auth.md#token-spec",
        "   */",
        "  get token() {",
        '    return "";',
        "  }",
        "  set token(value: string) {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0]?.canonicalId).toBe("AuthService.token");
      expect(result.diagnostics).toEqual([]);
    });

    test("emits duplicate_code_symbol when a static and instance member share a name", () => {
      const content = [
        "export class AuthService {",
        "  /**",
        "   * @doc docs/auth.md#static-create",
        "   */",
        "  static create() {}",
        "  /**",
        "   * @doc docs/auth.md#instance-create",
        "   */",
        "  create() {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.diagnostics.map((d) => d.code)).toEqual(["duplicate_code_symbol"]);
    });

    test("extracts an interface member", () => {
      const content = [
        "export interface AuthService {",
        "  /**",
        "   * @doc docs/auth.md#login-spec",
        "   */",
        "  login(): void;",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols[0]?.canonicalId).toBe("AuthService.login");
      expect(result.diagnostics).toEqual([]);
    });

    test("extracts an object type alias member", () => {
      const content = [
        "export type AuthConfig = {",
        "  /**",
        "   * @doc docs/auth.md#retries-spec",
        "   */",
        "  retries: number;",
        "};",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols[0]?.canonicalId).toBe("AuthConfig.retries");
      expect(result.diagnostics).toEqual([]);
    });

    test("qualifies class expression members by the exported binding name", () => {
      const content = [
        "export const Public = class Internal {",
        "  /**",
        "   * @doc docs/auth.md#login-spec",
        "   */",
        "  login() {}",
        "};",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols.map((symbol) => symbol.canonicalId)).toContain("Public.login");
    });

    test("does not descend into a union type alias", () => {
      const content = [
        "export type AuthConfig =",
        "  | {",
        "      /**",
        "       * @doc docs/auth.md#retries-spec",
        "       */",
        "      retries: number;",
        "    }",
        "  | undefined;",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols.map((symbol) => symbol.canonicalId)).not.toContain(
        "AuthConfig.retries",
      );
    });

    test("does not treat an anonymous default-exported class as a container", () => {
      const content = [
        "export default class {",
        "  /**",
        "   * @doc docs/auth.md#login-spec",
        "   */",
        "  login() {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.diagnostics.map((d) => d.code)).toEqual(["unsupported_declaration"]);
    });

    test("diagnoses an annotated member of a non-exported class", () => {
      const content = [
        "class AuthService {",
        "  /**",
        "   * @doc docs/auth.md#login-spec",
        "   */",
        "  login() {}",
        "}",
        "",
      ].join("\n");

      const result = scan(content);

      expect(result.symbols).toEqual([]);
      expect(result.diagnostics.map((d) => d.code)).toEqual(["unsupported_declaration"]);
    });

    describe("members that cannot be endpoints", () => {
      const DOC = "  /**\n   * @doc docs/auth.md#spec\n   */\n";

      const rejected: Array<[string, string]> = [
        ["a private member", `export class C {\n${DOC}  private m() {}\n}\n`],
        ["a private identifier member", `export class C {\n${DOC}  #m() {}\n}\n`],
        ["a string-literal name", `export class C {\n${DOC}  "space name"() {}\n}\n`],
        ["a computed name", `export class C {\n${DOC}  [Symbol.iterator]() {}\n}\n`],
        ["an index signature", `export interface C {\n${DOC}  [key: string]: number;\n}\n`],
        ["a call signature", `export interface C {\n${DOC}  (): void;\n}\n`],
        ["a construct signature", `export interface C {\n${DOC}  new (): C;\n}\n`],
        ["an enum member", `export enum C {\n${DOC}  A,\n}\n`],
        [
          "a constructor parameter property",
          "export class C {\n  constructor(/** @doc docs/auth.md#spec */ private x: string) {}\n}\n",
        ],
      ];

      test.each(rejected)("emits unsupported_declaration for %s", (_label, content) => {
        const result = scan(content);

        expect(result.symbols).toEqual([]);
        expect(result.diagnostics.map((d) => d.code)).toContain("unsupported_declaration");
      });

      test("ignores an annotated ordinary constructor parameter", () => {
        // An ordinary parameter declares nothing on the type, so its annotation
        // is an orphan comment, which no language reports.
        const content = [
          "export class C {",
          "  constructor(/** @doc docs/auth.md#spec */ x: string) {",
          "    void x;",
          "  }",
          "}",
          "",
        ].join("\n");

        const result = scan(content);

        expect(result.symbols).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });

      test("excludes a protected member when visibility lists only public", () => {
        const content = [
          "export class AuthService {",
          "  /**",
          "   * @doc docs/auth.md#refresh-spec",
          "   */",
          "  protected refresh() {}",
          "}",
          "",
        ].join("\n");

        const result = scanTypeScript(FILE, content, { visibility: ["public"] });

        expect(result.symbols).toEqual([]);
      });

      test("names members in the unsupported_declaration message", () => {
        const content = "export class C {\n  /**\n   * @doc docs/a.md#s\n   */\n  #m() {}\n}\n";

        const result = scan(content);

        expect(result.diagnostics[0]?.message).toContain("member");
      });

      test("keeps a protected member as an endpoint", () => {
        const content = [
          "export class AuthService {",
          "  /**",
          "   * @doc docs/auth.md#refresh-spec",
          "   */",
          "  protected refresh() {}",
          "}",
          "",
        ].join("\n");

        const result = scan(content);

        expect(result.symbols[0]?.canonicalId).toBe("AuthService.refresh");
        expect(result.diagnostics).toEqual([]);
      });
    });
  });
});
