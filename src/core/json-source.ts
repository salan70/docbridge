import type { Position, Range } from "./types";

/**
 * One member of a JSON object: the decoded key, the source range of the key
 * token including its quotes, and the member's value node.
 */
export type JsonMember = {
  key: string;
  keyRange: Range;
  value: JsonNode;
};

type JsonNodeBase = {
  /** Source range of the whole node, 1-based and end-exclusive. */
  range: Range;
};

export type JsonObjectNode = JsonNodeBase & {
  kind: "object";
  members: JsonMember[];
};

export type JsonArrayNode = JsonNodeBase & {
  kind: "array";
  elements: JsonNode[];
};

export type JsonStringNode = JsonNodeBase & {
  kind: "string";
  value: string;
  /** Range of the text between the quotes, used to point diagnostics at it. */
  contentRange: Range;
};

export type JsonNumberNode = JsonNodeBase & { kind: "number"; value: number };
export type JsonBooleanNode = JsonNodeBase & { kind: "boolean"; value: boolean };
export type JsonNullNode = JsonNodeBase & { kind: "null"; value: null };

export type JsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

export type ParseJsonSourceResult =
  | { ok: true; root: JsonNode }
  | { ok: false; message: string; position: Position };

/** Thrown internally to unwind to `parseJsonSource`, never exposed. */
class JsonSyntaxError extends Error {
  readonly position: Position;

  constructor(message: string, position: Position) {
    super(message);
    this.position = position;
  }
}

const ESCAPE_VALUES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Parse JSON text into a node tree that records the 1-based line and column of
 * every value and object key.
 *
 * The grammar is RFC 8259 exactly, so a document this function accepts is one
 * `JSON.parse` accepts and vice versa. Comments, trailing commas, unquoted
 * keys, and a leading byte order mark are all errors. Columns count UTF-16
 * code units, matching the positions the code scanners report.
 *
 * @doc docs/specs/link-manifest.md#manifest-syntax
 */
export function parseJsonSource(text: string): ParseJsonSourceResult {
  const reader = new JsonReader(text);
  try {
    reader.skipWhitespace();
    const root = reader.readValue();
    reader.skipWhitespace();
    if (!reader.atEnd()) {
      reader.fail("Unexpected trailing content after the JSON value.");
    }
    return { ok: true, root };
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return { ok: false, message: error.message, position: error.position };
    }
    throw error;
  }
}

/**
 * A cursor over the source text that tracks line and column while it reads.
 *
 * Position tracking is why this exists at all: `JSON.parse` reports no usable
 * location, and the link manifest needs each entry to carry one.
 */
class JsonReader {
  private readonly text: string;
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(text: string) {
    this.text = text;
  }

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  /** Abort the parse at the current position. */
  fail(message: string): never {
    throw new JsonSyntaxError(message, this.position());
  }

  position(): Position {
    return { line: this.line, column: this.column };
  }

  skipWhitespace(): void {
    while (!this.atEnd()) {
      const char = this.text[this.index] ?? "";
      if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") {
        return;
      }
      this.advance();
    }
  }

  readValue(): JsonNode {
    if (this.atEnd()) {
      this.fail("Unexpected end of input where a JSON value was expected.");
    }
    const char = this.text[this.index] ?? "";
    switch (char) {
      case "{":
        return this.readObject();
      case "[":
        return this.readArray();
      case '"':
        return this.readString();
      case "t":
        return this.readKeyword("true", true);
      case "f":
        return this.readKeyword("false", false);
      case "n":
        return this.readNull();
      default:
        return this.readNumber();
    }
  }

  private readObject(): JsonObjectNode {
    const start = this.position();
    this.expect("{");
    const members: JsonMember[] = [];
    this.skipWhitespace();

    if (this.peek() === "}") {
      this.advance();
      return { kind: "object", members, range: { start, end: this.position() } };
    }

    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') {
        this.fail("Expected a quoted object key.");
      }
      const keyNode = this.readString();
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      const value = this.readValue();
      members.push({ key: keyNode.value, keyRange: keyNode.range, value });

      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.advance();
        continue;
      }
      if (next === "}") {
        this.advance();
        return { kind: "object", members, range: { start, end: this.position() } };
      }
      this.fail("Expected `,` or `}` in the object.");
    }
  }

  private readArray(): JsonArrayNode {
    const start = this.position();
    this.expect("[");
    const elements: JsonNode[] = [];
    this.skipWhitespace();

    if (this.peek() === "]") {
      this.advance();
      return { kind: "array", elements, range: { start, end: this.position() } };
    }

    for (;;) {
      this.skipWhitespace();
      elements.push(this.readValue());
      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.advance();
        continue;
      }
      if (next === "]") {
        this.advance();
        return { kind: "array", elements, range: { start, end: this.position() } };
      }
      this.fail("Expected `,` or `]` in the array.");
    }
  }

  private readString(): JsonStringNode {
    const start = this.position();
    this.expect('"');
    const contentStart = this.position();
    let value = "";

    for (;;) {
      if (this.atEnd()) {
        this.fail("Unterminated string.");
      }
      const char = this.text[this.index] ?? "";
      if (char === '"') {
        const contentEnd = this.position();
        this.advance();
        return {
          kind: "string",
          value,
          contentRange: { start: contentStart, end: contentEnd },
          range: { start, end: this.position() },
        };
      }
      if (char === "\\") {
        this.advance();
        value += this.readEscape();
        continue;
      }
      if (char < " ") {
        this.fail("Unescaped control character in a string.");
      }
      this.advance();
      value += char;
    }
  }

  private readEscape(): string {
    if (this.atEnd()) {
      this.fail("Unterminated escape sequence.");
    }
    const char = this.text[this.index] ?? "";
    const simple = ESCAPE_VALUES[char];
    if (simple !== undefined) {
      this.advance();
      return simple;
    }
    if (char !== "u") {
      this.fail(`Unknown escape sequence \`\\${char}\`.`);
    }
    this.advance();
    const digits = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
      this.fail("A `\\u` escape needs four hexadecimal digits.");
    }
    for (let offset = 0; offset < 4; offset += 1) {
      this.advance();
    }
    return String.fromCharCode(Number.parseInt(digits, 16));
  }

  private readNumber(): JsonNumberNode {
    const start = this.position();
    const pattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    pattern.lastIndex = this.index;
    const match = pattern.exec(this.text);
    if (match === null || match[0].length === 0) {
      this.fail("Expected a JSON value.");
    }
    for (let offset = 0; offset < match[0].length; offset += 1) {
      this.advance();
    }
    // A number may not be followed by another digit-like character, which is
    // how `01` and `1.2.3` are rejected the way `JSON.parse` rejects them.
    if (/[0-9a-zA-Z.+-]/.test(this.peek() ?? "")) {
      this.fail("Malformed number.");
    }
    return { kind: "number", value: Number(match[0]), range: { start, end: this.position() } };
  }

  private readNull(): JsonNullNode {
    const start = this.position();
    this.consumeWord("null");
    return { kind: "null", value: null, range: { start, end: this.position() } };
  }

  private readKeyword(word: "true" | "false", value: boolean): JsonBooleanNode {
    const start = this.position();
    this.consumeWord(word);
    return { kind: "boolean", value, range: { start, end: this.position() } };
  }

  private consumeWord(word: string): void {
    if (this.text.slice(this.index, this.index + word.length) !== word) {
      this.fail(`Expected \`${word}\`.`);
    }
    for (let offset = 0; offset < word.length; offset += 1) {
      this.advance();
    }
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      this.fail(`Expected \`${char}\`.`);
    }
    this.advance();
  }

  /**
   * Consume one UTF-16 code unit. A `\n` opens a new line; a `\r` does too
   * unless the `\n` of a CRLF pair follows, which keeps CRLF one line break.
   */
  private advance(): void {
    const char = this.text[this.index] ?? "";
    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
      return;
    }
    if (char === "\r") {
      if (this.text[this.index] === "\n") {
        this.index += 1;
      }
      this.line += 1;
      this.column = 1;
      return;
    }
    this.column += 1;
  }
}
