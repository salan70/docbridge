import { createHash } from "node:crypto";

/**
 * The content variants the parser gate sends besides the file itself: one
 * injected annotation and three malformed mutations, all deterministic.
 */
export const INJECTED_TARGET = "docs/gate.md#injected";

const INJECTED_PREFIX = "/// @doc ";

/** The number of files per language and set that get malformed variants. */
export const MALFORMED_FILE_LIMIT = 500;

export type MalformedName = "delete-brace" | "insert-paren" | "truncate";

export type ReportedSymbol = {
  canonicalId: string;
  endpoint: string;
  location: { line: number; column: number };
};

export type ExpectedLink = {
  source: string;
  target: string;
  location: { line: number; column: number };
};

export type Injection = {
  content: string;
  canonicalId: string;
  /** The link the insertion alone adds to the scan result. */
  expected: ExpectedLink;
};

function compareHash(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The first 12 hex digits of the SHA-256 as an integer, exact in a double. */
export function hashNumber(text: string): number {
  return Number.parseInt(sha256Hex(text).slice(0, 12), 16);
}

/**
 * Inserts an `@doc` annotation line before the declaration of the undocumented
 * symbol with the smallest `canonicalId` hash among those that can take it, or
 * returns `undefined` when none can. A symbol can take it when its name line
 * follows a blank line, an opening brace, or the start of the file, and holds
 * no other reported symbol.
 */
export function injectAnnotation(
  content: string,
  reported: { symbols: readonly ReportedSymbol[]; undocumentedSymbols: readonly ReportedSymbol[] },
): Injection | undefined {
  const lines = content.split("\n");
  const all = [...reported.symbols, ...reported.undocumentedSymbols];
  const candidates = reported.undocumentedSymbols
    .filter((symbol) => canTakeAnnotation(symbol, lines, all))
    .map((symbol) => ({ symbol, hash: sha256Hex(symbol.canonicalId) }))
    .toSorted((a, b) => compareHash(a.hash, b.hash));
  const chosen = candidates[0]?.symbol;
  if (chosen === undefined) {
    return undefined;
  }
  const index = chosen.location.line - 1;
  const nameLine = lines[index] ?? "";
  const indent = /^[ \t]*/.exec(nameLine)?.[0] ?? "";
  const offset = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  const inserted = `${indent}${INJECTED_PREFIX}${INJECTED_TARGET}${lineEnding(lines, index)}`;
  return {
    content: content.slice(0, offset) + inserted + content.slice(offset),
    canonicalId: chosen.canonicalId,
    expected: {
      source: chosen.endpoint,
      target: INJECTED_TARGET,
      location: { line: chosen.location.line, column: indent.length + INJECTED_PREFIX.length + 1 },
    },
  };
}

function canTakeAnnotation(
  symbol: ReportedSymbol,
  lines: readonly string[],
  all: readonly ReportedSymbol[],
): boolean {
  const { line } = symbol.location;
  if (line < 1 || line > lines.length) {
    return false;
  }
  const previous = line === 1 ? "" : (lines[line - 2] ?? "");
  const opensBlock = previous.trim() === "" || previous.trimEnd().endsWith("{");
  const identity = symbolIdentity(symbol);
  const shared = all.some(
    (other) => other.location.line === line && symbolIdentity(other) !== identity,
  );
  return opensBlock && !shared;
}

function symbolIdentity(symbol: ReportedSymbol): string {
  return `${symbol.canonicalId}@${symbol.location.line}:${symbol.location.column}`;
}

/** The terminator of the line at `index`, or the previous line's when it has none. */
function lineEnding(lines: readonly string[], index: number): string {
  const after = (at: number): string | undefined => {
    if (at < 0 || at >= lines.length - 1) {
      return undefined;
    }
    return lines[at]?.endsWith("\r") ? "\r\n" : "\n";
  };
  return after(index) ?? after(index - 1) ?? "\n";
}

/** The files that get malformed variants: the smallest `repository/path` hashes. */
export function selectMalformedFiles<T extends { repository: string; path: string }>(
  files: readonly T[],
  limit: number = MALFORMED_FILE_LIMIT,
): T[] {
  return files
    .map((file) => ({ file, hash: sha256Hex(`${file.repository}/${file.path}`) }))
    .toSorted((a, b) => compareHash(a.hash, b.hash))
    .slice(0, limit)
    .map(({ file }) => file);
}

/**
 * The malformed variants of one file's content. `fileKey` is
 * `<repository>/<path>`; each mutation derives its position from the hash of
 * `<fileKey>:<name>`.
 */
export function malformedVariants(
  content: string,
  fileKey: string,
): { name: MalformedName; content: string }[] {
  const variants: { name: MalformedName; content: string | undefined }[] = [
    { name: "delete-brace", content: deleteBrace(content, hashNumber(`${fileKey}:delete-brace`)) },
    { name: "insert-paren", content: insertParen(content, hashNumber(`${fileKey}:insert-paren`)) },
    { name: "truncate", content: truncate(content, hashNumber(`${fileKey}:truncate`)) },
  ];
  return variants.flatMap(({ name, content: mutated }) =>
    mutated === undefined ? [] : [{ name, content: mutated }],
  );
}

function deleteBrace(content: string, hash: number): string | undefined {
  const positions: number[] = [];
  for (let index = content.indexOf("}"); index !== -1; index = content.indexOf("}", index + 1)) {
    positions.push(index);
  }
  const position = positions[hash % positions.length];
  return position === undefined
    ? undefined
    : content.slice(0, position) + content.slice(position + 1);
}

function insertParen(content: string, hash: number): string {
  const points = Array.from(content);
  const at = hash % (points.length + 1);
  return `${points.slice(0, at).join("")}(${points.slice(at).join("")}`;
}

/** Keeps the first `1 + hash % (lines - 1)` lines, so at least one line is dropped. */
function truncate(content: string, hash: number): string | undefined {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (lines.length < 2) {
    return undefined;
  }
  return lines.slice(0, 1 + (hash % (lines.length - 1))).join("");
}
