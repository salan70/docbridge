import type { Range } from "../model/types";
import { dedentBlockLines } from "./indent";

type SlicedSourceRange = {
  content: string;
  startLine: number;
  endLine: number;
};

/** Slice and dedent an exclusive source range from a file's content. */
export function sliceSourceRange(content: string, range: Range): SlicedSourceRange {
  const startLine = range.start.line;
  const endLine = range.end.column === 1 ? range.end.line - 1 : range.end.line;
  const lines = content.split("\n").slice(startLine - 1, endLine);

  // Cut the end first: its column counts from the start of the original line,
  // which a range that starts and ends on one line would otherwise shift.
  const lastIndex = lines.length - 1;
  const lastLine = lines[lastIndex];
  if (lastLine !== undefined && range.end.column > 1) {
    lines[lastIndex] = lastLine.slice(0, range.end.column - 1);
  }
  const firstLine = lines[0];
  if (firstLine !== undefined) {
    lines[0] = firstLine.slice(range.start.column - 1);
  }

  return {
    content: dedentBlockLines(lines, range.start.column).join("\n"),
    startLine,
    endLine,
  };
}
