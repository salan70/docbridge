import { describe, expect, test } from "bun:test";

import type { CodeSymbolEndpoint, DocLinkAnnotation } from "./types";
import { scanTypeScript } from "./typescript";

const FILE = "src/auth/login.ts";

function scan(content: string, filePath = FILE) {
  return scanTypeScript(filePath, content);
}

describe(scanTypeScript, () => {
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

        expect(result.symbols).toEqual([expectedSymbol]);

        const expectedLink: DocLinkAnnotation = {
          direction: "code-to-doc",
          source: `${FILE}#${symbolName}`,
          target: "docs/auth.md#login-spec",
          location: expect.objectContaining({
            filePath: FILE,
          }) as unknown as DocLinkAnnotation["location"],
        };

        expect(result.links).toEqual([expectedLink]);
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

  test("matches the examples/basic login fixture: one symbol and one link", () => {
    const content =
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport async function login() {\n  return { ok: true };\n}\n";
    const result = scanTypeScript("src/auth/login.ts", content);

    expect(result.diagnostics).toEqual([]);
    expect(result.symbols).toEqual([
      {
        kind: "code",
        filePath: "src/auth/login.ts",
        symbolName: "login",
        endpoint: "src/auth/login.ts#login",
        location: { filePath: "src/auth/login.ts", line: 4, column: 1 },
      },
    ]);
    expect(result.links).toEqual([
      {
        direction: "code-to-doc",
        source: "src/auth/login.ts#login",
        target: "docs/auth.md#login-spec",
        location: { filePath: "src/auth/login.ts", line: 4, column: 1 },
      },
    ]);
  });
});
