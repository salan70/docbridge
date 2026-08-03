import { expect, test } from "bun:test";

import { sliceSourceRange } from "./source-range";

test("sliceSourceRange excludes the line at an exclusive column-one end", () => {
  const content = ["  first", "    second", "next declaration", ""].join("\n");

  expect(
    sliceSourceRange(content, {
      start: { line: 1, column: 3 },
      end: { line: 3, column: 1 },
    }),
  ).toEqual({
    content: "first\nsecond",
    startLine: 1,
    endLine: 2,
  });
});
