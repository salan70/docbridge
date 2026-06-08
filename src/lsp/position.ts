import type { Position, Range } from "../core/types";

/** LSP position: 0-based line and UTF-16 `character`. */
export type LspPosition = {
  line: number;
  character: number;
};

/** LSP range with 0-based, end-exclusive positions. */
export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

/**
 * Convert a SpecLink 1-based position to an LSP 0-based position. Both encodings
 * count columns in UTF-16 code units, so only the index base changes.
 *
 * @doc docs/specs/lsp.md#positions-and-paths
 */
export function toLspPosition(position: Position): LspPosition {
  return { line: position.line - 1, character: position.column - 1 };
}

/** Convert an LSP 0-based position to a SpecLink 1-based position. */
export function fromLspPosition(position: LspPosition): Position {
  return { line: position.line + 1, column: position.character + 1 };
}

/** Convert a SpecLink 1-based range to an LSP 0-based range. */
export function toLspRange(range: Range): LspRange {
  return { start: toLspPosition(range.start), end: toLspPosition(range.end) };
}

/**
 * Test whether a SpecLink 1-based `position` falls within `range`. The range end
 * is exclusive, mirroring the LSP range model.
 */
export function rangeContains(range: Range, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.column < range.start.column) {
    return false;
  }
  if (position.line === range.end.line && position.column >= range.end.column) {
    return false;
  }
  return true;
}
