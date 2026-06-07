import { describe, expect, test } from "bun:test";

import { definition } from "../../src/lsp/navigation";
import { CODE_FILE, DOC_FILE, stateOf } from "./fixtures";

const CODE = "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n";
const DOC = "<!-- @code src/auth/login.ts#login -->\n## Login Spec\n";

describe(definition, () => {
  test("code to doc jumps to the heading text range", () => {
    const result = definition(stateOf(CODE, DOC), CODE_FILE, { line: 4, column: 18 });

    expect(result).toEqual([
      {
        filePath: DOC_FILE,
        range: { start: { line: 2, column: 4 }, end: { line: 2, column: 14 } },
      },
    ]);
  });

  test("doc to code jumps to the declaration name range", () => {
    const result = definition(stateOf(CODE, DOC), DOC_FILE, { line: 2, column: 5 });

    expect(result).toEqual([
      {
        filePath: CODE_FILE,
        range: { start: { line: 4, column: 17 }, end: { line: 4, column: 22 } },
      },
    ]);
  });

  test("one-to-many returns multiple locations", () => {
    const code = "/**\n * @doc docs/auth.md#login-spec\n * @doc docs/auth.md#flow\n */\nexport function login() {}\n";
    const doc = "## Login Spec\n\n## Flow\n";

    const result = definition(stateOf(code, doc), CODE_FILE, { line: 5, column: 18 });

    expect(result).toHaveLength(2);
    // Ordered by document location: login-spec (line 1) then flow (line 3).
    expect(result.map((locator) => locator.range.start.line)).toEqual([1, 3]);
  });

  test("returns nothing when the cursor is not on a linked element", () => {
    expect(definition(stateOf(CODE, DOC), CODE_FILE, { line: 4, column: 1 })).toEqual([]);
  });
});
