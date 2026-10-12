import { expect, test } from "bun:test";

import { firstDifference, formatResultLine, specifiedRequest } from "./compare";

test("equal values have no difference", () => {
  expect(firstDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBeUndefined();
});

test("object key order is ignored", () => {
  expect(firstDifference({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBeUndefined();
});

test("array order is significant", () => {
  expect(firstDifference({ a: [1, 2] }, { a: [2, 1] })).toBe("/a/0");
});

test("array length differences are located at the first missing index", () => {
  expect(firstDifference({ a: [1, 2] }, { a: [1] })).toBe("/a/1");
  expect(firstDifference({ a: [1] }, { a: [1, 2] })).toBe("/a/1");
});

test("a missing or extra key is located at that key", () => {
  expect(firstDifference({ a: 1, b: 2 }, { a: 1 })).toBe("/b");
  expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toBe("/b");
});

test("values of different types differ", () => {
  expect(firstDifference({ a: 1 }, { a: "1" })).toBe("/a");
  expect(firstDifference({ a: null }, { a: {} })).toBe("/a");
});

test("keys with undefined values are treated as absent", () => {
  expect(firstDifference({ a: 1 }, { a: 1, b: undefined })).toBeUndefined();
});

const parseError = {
  code: "code_parse_error",
  language: "swift",
  location: { column: 12, filePath: "Input.swift", line: 3 },
  message: "Swift parse error: extraneous code ')' at top level.",
  severity: "error",
  target: "Input.swift",
};

test("a code_parse_error diagnostic is compared by code only", () => {
  const other = {
    code: "code_parse_error",
    message: "different",
    location: { line: 9 },
  };
  expect(firstDifference({ diagnostics: [parseError] }, { diagnostics: [other] })).toBeUndefined();
});

test("a code_parse_error diagnostic still differs from another code", () => {
  expect(firstDifference({ diagnostics: [parseError] }, { diagnostics: [{ code: "other" }] })).toBe(
    "/diagnostics/0/code",
  );
});

test("other diagnostics are compared in full", () => {
  const expected = { code: "scanner_failed", message: "a" };
  const actual = { code: "scanner_failed", message: "b" };
  expect(firstDifference({ diagnostics: [expected] }, { diagnostics: [actual] })).toBe(
    "/diagnostics/0/message",
  );
});

test("the parse error exception applies only to diagnostics arrays", () => {
  expect(
    firstDifference(
      { symbols: [{ code: "code_parse_error", x: 1 }] },
      { symbols: [{ code: "code_parse_error", x: 2 }] },
    ),
  ).toBe("/symbols/0/x");
});

test("a result line names the case and, on failure, the first difference", () => {
  expect(formatResultLine("parse-error/swift", undefined)).toBe("ok   parse-error/swift");
  expect(formatResultLine("parse-error/swift", "/symbols/0")).toBe(
    "FAIL parse-error/swift (first difference at /symbols/0)",
  );
});

test("a specified request carries the language's path, content, and options", () => {
  expect(specifiedRequest("swift", "class A {}", { visibility: ["public"] }, "id-1")).toEqual({
    schemaVersion: 1,
    requestId: "id-1",
    language: "swift",
    projectRoot: "/",
    files: [{ filePath: "Sources/Input.swift", content: "class A {}" }],
    options: { visibility: ["public"] },
  });
  expect(specifiedRequest("dart", "", {}, "id-2").files).toEqual([
    { filePath: "lib/input.dart", content: "" },
  ]);
});
