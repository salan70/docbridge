import { expect, test } from "bun:test";

import { parseCheckOptions } from "./index";

test("parseCheckOptions reads root, json, and audit flags", () => {
  expect(parseCheckOptions(["--root", "examples/basic", "--json", "--audit"])).toEqual({
    root: "examples/basic",
    json: true,
    audit: true,
  });
});
