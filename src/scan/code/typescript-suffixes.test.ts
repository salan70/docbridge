import { expect, test } from "bun:test";

import { scanTypeScript } from "./typescript";

const JSX_COMPONENT = [
  "/** @doc docs/ui.md#login-form */",
  "export function LoginForm() {",
  '  return <form className="login" />;',
  "}",
  "",
].join("\n");

test("a .tsx file parses JSX inside a declaration", () => {
  const result = scanTypeScript("src/login-form.tsx", JSX_COMPONENT);

  expect(result.diagnostics).toEqual([]);
  expect(result.language).toBe("typescript");
  expect(result.symbols.map((symbol) => symbol.endpoint)).toEqual(["src/login-form.tsx#LoginForm"]);
  expect(result.links.map((link) => link.target)).toEqual(["docs/ui.md#login-form"]);
});

test("a .ts file keeps rejecting JSX as a parse error", () => {
  const result = scanTypeScript("src/login-form.ts", JSX_COMPONENT);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["code_parse_error"]);
  expect(result.symbols).toEqual([]);
});

test.each(["src/module.mts", "src/common.cts"])(
  "%s parses as TypeScript, type annotations included",
  (filePath) => {
    const result = scanTypeScript(
      filePath,
      "/** @doc docs/auth.md#login */\nexport function login(email: string): void {}\n",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.map((symbol) => symbol.canonicalId)).toEqual(["login"]);
  },
);
