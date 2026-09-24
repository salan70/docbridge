import { describe, expect, test } from "bun:test";

import { CODE_FILE, DOC_FILE, stateOf } from "./fixtures";
import { references } from "./navigation";

describe(references, () => {
  test("from a heading lists every code symbol that links to it", () => {
    const code = [
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function login() {}\n",
      "/**\n * @doc docs/auth.md#login-spec\n */\nexport function relogin() {}\n",
    ].join("\n");
    const doc = "## Login Spec\n";

    // `Login Spec` begins at column 4 on line 1.
    const result = references(stateOf(code, doc), DOC_FILE, { line: 1, column: 5 });

    expect(result.map((locator) => locator.filePath)).toEqual([CODE_FILE, CODE_FILE]);
    expect(result).toHaveLength(2);
  });
});
