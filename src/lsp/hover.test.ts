import { describe, expect, test } from "bun:test";

import { hover } from "./hover";
import { CODE_FILE, DOC_FILE, stateOf } from "./fixtures";

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

  test("concatenates one-to-many sections with a divider", () => {
    const code = "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#flow\n */\nexport function login() {}\n";
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
