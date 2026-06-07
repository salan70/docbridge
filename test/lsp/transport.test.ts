import { describe, expect, test } from "bun:test";

import { encodeMessage, MessageReader } from "../../src/lsp/transport";

describe("encodeMessage", () => {
  test("frames a message with a CRLFCRLF header separator and UTF-8 body", () => {
    const buffer = encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
    const text = buffer.toString("utf8");

    const separatorIndex = text.indexOf("\r\n\r\n");
    expect(separatorIndex).toBeGreaterThan(0);

    const header = text.slice(0, separatorIndex);
    const body = text.slice(separatorIndex + 4);

    const expectedBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(body).toBe(expectedBody);
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(expectedBody, "utf8")}`);
  });

  test("uses the UTF-8 byte length for a multi-byte body, not the string length", () => {
    const message = { text: "こんにちは🌟" };
    const buffer = encodeMessage(message);
    const text = buffer.toString("utf8");

    const separatorIndex = text.indexOf("\r\n\r\n");
    const header = text.slice(0, separatorIndex);
    const body = text.slice(separatorIndex + 4);

    const byteLength = Buffer.byteLength(body, "utf8");
    expect(byteLength).toBeGreaterThan(body.length);
    expect(header).toBe(`Content-Length: ${byteLength}`);
  });
});

describe("MessageReader", () => {
  test("round-trips an encoded ASCII message", () => {
    const message = { jsonrpc: "2.0", id: 7, method: "initialize", params: { rootUri: "file:///tmp" } };
    const reader = new MessageReader();

    reader.append(encodeMessage(message));

    expect(reader.read()).toEqual([message]);
  });

  test("round-trips an encoded multi-byte UTF-8 message", () => {
    const message = { jsonrpc: "2.0", id: 8, result: { hover: "ログイン処理🌟" } };
    const reader = new MessageReader();

    reader.append(encodeMessage(message));

    expect(reader.read()).toEqual([message]);
  });

  test("returns both messages when two are concatenated in one append", () => {
    const first = { jsonrpc: "2.0", id: 1, method: "a" };
    const second = { jsonrpc: "2.0", id: 2, method: "b" };
    const reader = new MessageReader();

    const combined = Buffer.concat([encodeMessage(first), encodeMessage(second)]);
    reader.append(combined);

    expect(reader.read()).toEqual([first, second]);
  });

  test("yields a message only once both body halves arrive (split mid-body)", () => {
    const message = { jsonrpc: "2.0", id: 3, method: "split-body" };
    const reader = new MessageReader();
    const encoded = encodeMessage(message);

    const separatorIndex = encoded.indexOf("\r\n\r\n");
    const splitPoint = separatorIndex + 4 + 2; // a couple of bytes into the body

    reader.append(encoded.subarray(0, splitPoint));
    expect(reader.read()).toEqual([]);

    reader.append(encoded.subarray(splitPoint));
    expect(reader.read()).toEqual([message]);
  });

  test("yields a message only once both header halves arrive (split mid-header)", () => {
    const message = { jsonrpc: "2.0", id: 4, method: "split-header" };
    const reader = new MessageReader();
    const encoded = encodeMessage(message);

    const splitPoint = 5; // mid "Content-Length"

    reader.append(encoded.subarray(0, splitPoint));
    expect(reader.read()).toEqual([]);

    reader.append(encoded.subarray(splitPoint));
    expect(reader.read()).toEqual([message]);
  });

  test("returns an empty array when no complete message is buffered yet", () => {
    const reader = new MessageReader();

    expect(reader.read()).toEqual([]);

    reader.append(Buffer.from("Content-Length: 10\r\n", "utf8"));
    expect(reader.read()).toEqual([]);
  });

  test("does not lose a trailing partial message after returning a complete one", () => {
    const first = { jsonrpc: "2.0", id: 5, method: "complete" };
    const second = { jsonrpc: "2.0", id: 6, method: "partial" };
    const reader = new MessageReader();

    const secondEncoded = encodeMessage(second);
    const secondSeparator = secondEncoded.indexOf("\r\n\r\n");
    const partial = secondEncoded.subarray(0, secondSeparator + 4 + 1);

    reader.append(Buffer.concat([encodeMessage(first), partial]));
    expect(reader.read()).toEqual([first]);

    reader.append(secondEncoded.subarray(secondSeparator + 4 + 1));
    expect(reader.read()).toEqual([second]);
  });

  test("throws when a header block lacks Content-Length", () => {
    const reader = new MessageReader();
    reader.append(Buffer.from("X-Foo: bar\r\n\r\n{}", "utf8"));

    expect(() => reader.read()).toThrow();
  });
});
