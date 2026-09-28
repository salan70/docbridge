import { expect, test } from "bun:test";

import { parseJsonSource, type JsonNode } from "./json-source";

/** Reduce a node tree to the plain value `JSON.parse` would have produced. */
function toPlain(node: JsonNode): unknown {
  switch (node.kind) {
    case "object": {
      const result: Record<string, unknown> = {};
      for (const member of node.members) {
        result[member.key] = toPlain(member.value);
      }
      return result;
    }
    case "array":
      return node.elements.map(toPlain);
    default:
      return node.value;
  }
}

function parseOk(text: string): JsonNode {
  const result = parseJsonSource(text);
  if (!result.ok) {
    throw new Error(`expected a parse, got ${result.message}`);
  }
  return result.root;
}

test.each([
  ['{"links":[]}', "empty array member"],
  ['{"a":1,"b":-2.5e+10,"c":0}', "numbers"],
  ['{"a":true,"b":false,"c":null}', "literals"],
  ['["x",{"y":["z"]}]', "nested containers"],
  ['{"escaped":"a\\"b\\\\c\\/d\\ne\\tf\\u00e9"}', "string escapes"],
  ["[]", "empty array"],
  ["{}", "empty object"],
  ['"bare string"', "top-level string"],
  ["42", "top-level number"],
  ['  \n\t {"a" : \n 1 } \n ', "insignificant whitespace"],
  ['{"dup":1,"dup":2}', "duplicate keys"],
])("parseJsonSource produces the JSON.parse value for %s (%s)", (text) => {
  expect(toPlain(parseOk(text))).toEqual(JSON.parse(text));
});

test("parseJsonSource records the range of every value", () => {
  const root = parseOk('{\n  "code": "src/a.ts#A"\n}');

  expect(root.range).toEqual({ start: { line: 1, column: 1 }, end: { line: 3, column: 2 } });
  if (root.kind !== "object") {
    throw new Error("expected an object");
  }
  const member = root.members[0];
  expect(member?.value.range).toEqual({
    start: { line: 2, column: 11 },
    end: { line: 2, column: 23 },
  });
});

test("parseJsonSource records the range of an object key", () => {
  const root = parseOk('{\n  "code": 1\n}');

  if (root.kind !== "object") {
    throw new Error("expected an object");
  }
  expect(root.members[0]?.keyRange).toEqual({
    start: { line: 2, column: 3 },
    end: { line: 2, column: 9 },
  });
});

test("parseJsonSource records a string content range excluding the quotes", () => {
  const root = parseOk('["ab"]');

  if (root.kind !== "array") {
    throw new Error("expected an array");
  }
  const element = root.elements[0];
  expect(element?.range).toEqual({ start: { line: 1, column: 2 }, end: { line: 1, column: 6 } });
  if (element?.kind !== "string") {
    throw new Error("expected a string");
  }
  expect(element.contentRange).toEqual({
    start: { line: 1, column: 3 },
    end: { line: 1, column: 5 },
  });
});

test("parseJsonSource counts an escape as its source characters, not its value", () => {
  const root = parseOk('["a\\u00e9b"]');

  if (root.kind !== "array") {
    throw new Error("expected an array");
  }
  const element = root.elements[0];
  expect(element?.kind === "string" ? element.value : undefined).toBe("aéb");
  expect(element?.range.end.column).toBe(12);
});

test("parseJsonSource counts lines across CRLF and LF", () => {
  const root = parseOk('{\r\n  "a": 1,\n  "b": 2\r\n}');

  if (root.kind !== "object") {
    throw new Error("expected an object");
  }
  expect(root.members[1]?.keyRange.start).toEqual({ line: 3, column: 3 });
});

test("parseJsonSource measures columns in UTF-16 code units", () => {
  const root = parseOk('["\u{1f600}", 1]');

  if (root.kind !== "array") {
    throw new Error("expected an array");
  }
  expect(root.elements[1]?.range.start.column).toBe(8);
});

test.each([
  ['{"a":1,}', "trailing comma in an object"],
  ["[1,]", "trailing comma in an array"],
  ['{"a":1} // note', "a line comment"],
  ["{'a':1}", "single-quoted string"],
  ['{"a":"unterminated}', "an unterminated string"],
  ['{"a":1}{"b":2}', "trailing garbage"],
  ["", "empty input"],
  ["   ", "blank input"],
  ["01", "a leading zero"],
  ['"\\x41"', "an unknown escape"],
  ["{a:1}", "an unquoted key"],
  ["[1 2]", "a missing comma"],
  ['{"a"1}', "a missing colon"],
  ["\u{feff}{}", "a byte order mark"],
])("parseJsonSource rejects %s (%s)", (text) => {
  expect(() => JSON.parse(text)).toThrow();

  const result = parseJsonSource(text);

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a failure");
  }
  expect(result.message.length).toBeGreaterThan(0);
  expect(result.position.line).toBeGreaterThanOrEqual(1);
  expect(result.position.column).toBeGreaterThanOrEqual(1);
});

test("parseJsonSource reports the position of the offending character", () => {
  const result = parseJsonSource('{\n  "a": 1,\n}');

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a failure");
  }
  expect(result.position).toEqual({ line: 3, column: 1 });
});
