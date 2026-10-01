import { describe, expect, test } from "bun:test";

import { scanTypeScript } from "../scan/code/typescript";
import { CODE_FILE, DOC_FILE, stateOf } from "./fixtures";
import { hover } from "./hover";

const CODE = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
const DOC = "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n\nLogin flow specification.\n";

// `login` spans columns 17..21 on line 4; `Login Spec` begins at column 4 on line 2.
const CODE_NAME = { line: 4, column: 18 };
const HEADING = { line: 2, column: 5 };

describe(hover, () => {
  test("code to doc renders the linked Markdown section inline", () => {
    const result = hover(stateOf(CODE, DOC), CODE_FILE, CODE_NAME);

    expect(result?.value).toContain("## Login Spec");
    expect(result?.value).toContain("Login flow specification.");
    expect(result?.range.start).toEqual({ line: 4, column: 17 });
  });

  test("doc to code shows the endpoint and the declaration signature line", () => {
    const result = hover(stateOf(CODE, DOC), DOC_FILE, HEADING);

    expect(result?.value).toContain("src/auth/login.ts#login");
    expect(result?.value).toContain("export function login()");
  });

  test("doc to code shows the whole signature when the name is on a later line", () => {
    const code =
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport const\n  login = (): void => {};\n";

    const result = hover(stateOf(code, DOC), DOC_FILE, HEADING);

    expect(result?.value).toBe(
      "**src/auth/login.ts#login**\n\n```ts\nexport const\n  login = (): void =>\n```",
    );
  });

  test("doc to code drops the leading doc comment but keeps decorators", () => {
    const code =
      "/**\n * @doc docs/auth.md#login-spec\n */\n@sealed\nexport class login {\n  run(): void {}\n}\n";

    const result = hover(stateOf(code, DOC), DOC_FILE, HEADING);

    expect(result?.value).toBe(
      "**src/auth/login.ts#login**\n\n```ts\n@sealed\nexport class login\n```",
    );
  });

  test("doc to code fences a .tsx signature as tsx", () => {
    const code =
      "/** @doc docs/auth.md#login-spec */\nexport function Login() {\n  return <form />;\n}\n";
    const doc = "<!-- @code src/auth/login.tsx#Login -->\n## Login Spec\n";

    const result = hover(stateOf(code, doc, scanTypeScript("src/auth/login.tsx", code)), DOC_FILE, {
      line: 2,
      column: 5,
    });

    expect(result?.value).toBe(
      "**src/auth/login.tsx#Login**\n\n```tsx\nexport function Login()\n```",
    );
  });

  test.each([
    ["src/auth/login.jsx", "jsx"],
    ["src/auth/login.mjs", "js"],
  ])("doc to code fences the %s signature as %s", (codeFile, fence) => {
    const code =
      "/** @doc docs/auth.md#login-spec */\nexport function Login() {\n  return null;\n}\n";
    const doc = `<!-- @code ${codeFile}#Login -->\n## Login Spec\n`;

    const result = hover(stateOf(code, doc, scanTypeScript(codeFile, code)), DOC_FILE, HEADING);

    expect(result?.value).toBe(
      `**${codeFile}#Login**\n\n\`\`\`${fence}\nexport function Login()\n\`\`\``,
    );
  });

  test("concatenates one-to-many sections with a divider", () => {
    const code =
      "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#flow\n */\nexport function login() {}\n";
    const doc = "## Login Spec\n\nFirst section.\n\n## Flow\n\nSecond section.\n";

    const result = hover(stateOf(code, doc), CODE_FILE, { line: 5, column: 18 });

    expect(result?.value).toContain("First section.");
    expect(result?.value).toContain("Second section.");
    expect(result?.value).toContain("---");
  });

  test("returns null when the cursor is not on a linked element", () => {
    expect(hover(stateOf(CODE, DOC), CODE_FILE, { line: 4, column: 1 })).toBeNull();
  });

  test("returns null when the element has no resolvable counterpart", () => {
    const code = "/**\n * @doc docs/auth.md#missing\n */\nexport function login() {}\n";
    expect(hover(stateOf(code, "## Other\n"), CODE_FILE, CODE_NAME)).toBeNull();
  });
});
