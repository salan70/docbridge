const HEADER_SEPARATOR = "\r\n\r\n";
const CONTENT_LENGTH_HEADER = "content-length";

/**
 * Serialize a JSON-RPC message to a framed `Buffer`.
 *
 * The frame is the LSP base protocol envelope: a `Content-Length` header whose
 * value is the UTF-8 byte length of the body, a blank line (`\r\n\r\n`), and the
 * UTF-8 encoded JSON body.
 */
export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.byteLength}${HEADER_SEPARATOR}`, "utf8");
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder for the LSP base protocol framing.
 *
 * Feed raw stdin chunks via {@link MessageReader.append}; {@link MessageReader.read}
 * returns every message that became complete since the last call, in order, and
 * leaves any partial trailing bytes buffered for the next `append()`.
 */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  /** Buffer a raw chunk of incoming bytes. */
  append(chunk: Uint8Array): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
  }

  /** Parse and return all complete messages currently buffered, as parsed JSON values. */
  read(): unknown[] {
    const messages: unknown[] = [];

    for (;;) {
      const message = this.readOne();
      if (message === null) {
        break;
      }
      messages.push(message.value);
    }

    return messages;
  }

  private readOne(): { value: unknown } | null {
    const separatorText = HEADER_SEPARATOR;
    const headerEnd = this.buffer.indexOf(separatorText, 0, "utf8");
    if (headerEnd === -1) {
      // No full header block yet.
      return null;
    }

    const headerText = this.buffer.toString("utf8", 0, headerEnd);
    const contentLength = parseContentLength(headerText);
    const bodyStart = headerEnd + separatorText.length;

    if (this.buffer.byteLength - bodyStart < contentLength) {
      // The full body has not arrived yet.
      return null;
    }

    const bodyEnd = bodyStart + contentLength;
    const bodyText = this.buffer.toString("utf8", bodyStart, bodyEnd);
    this.buffer = this.buffer.subarray(bodyEnd);

    return { value: JSON.parse(bodyText) };
  }
}

function parseContentLength(headerText: string): number {
  const lines = headerText.split("\r\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const name = line.slice(0, colonIndex).trim().toLowerCase();
    if (name !== CONTENT_LENGTH_HEADER) {
      continue;
    }

    const value = Number.parseInt(line.slice(colonIndex + 1).trim(), 10);
    if (Number.isNaN(value) || value < 0) {
      throw new Error(`Invalid Content-Length header: ${line}`);
    }
    return value;
  }

  throw new Error("Malformed LSP message: missing Content-Length header.");
}
