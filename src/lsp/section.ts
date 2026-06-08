/**
 * Markdown section extraction for the LSP hover feature.
 *
 * Mirrors the heading and fence detection rules in `src/core/markdown.ts`: ATX
 * headings allow up to three leading spaces and one to six `#`, and fenced code
 * blocks (backtick or tilde) are treated opaquely so a `#` inside a fence never
 * ends a section.
 */

/** Loose hover section length cap, in characters. */
export const MAX_SECTION_LENGTH = 2000;

/** Continuation marker appended when a section is truncated by the length cap. */
const TRUNCATION_MARKER = "\n\n…";

const atxHeadingPattern = /^ {0,3}(#{1,6})(?:[ \t]+.*)?$/;
const fenceOpenPattern = /^ {0,3}(?:`{3,}|~{3,})/;

/**
 * Extract the Markdown section beginning at the 1-based `headingLine`. Returns
 * the heading line plus its body, up to (but not including) the next heading at
 * the same or higher level (a heading whose `#` count is `<=` the start
 * heading's level). Deeper subsections are included. Fenced code blocks are
 * scanned opaquely, so a `#` line inside a fence does not end the section.
 * Trailing blank lines are trimmed.
 *
 * Best-effort handling for non-heading starts: if `headingLine` is out of range
 * (`< 1` or past the last line) an empty string is returned. If the start line
 * is in range but is not a heading, extraction proceeds from that line and ends
 * at the first heading of any level, so the caller still gets the surrounding
 * block of content.
 */
export function extractDocSection(content: string, headingLine: number): string {
  const lines = content.split("\n");
  const startIndex = headingLine - 1;

  if (startIndex < 0 || startIndex >= lines.length) {
    return "";
  }

  const startLine = lines[startIndex] ?? "";
  const startLevel = headingLevel(startLine);

  const collected: string[] = [startLine];

  let inFence = false;
  let fenceMarker: "`" | "~" | null = null;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (inFence) {
      collected.push(line);
      if (isFenceClose(line, fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }

    if (fenceOpenPattern.test(line)) {
      inFence = true;
      fenceMarker = line.trimStart().startsWith("`") ? "`" : "~";
      collected.push(line);
      continue;
    }

    const level = headingLevel(line);
    if (level !== null && terminatesSection(startLevel, level)) {
      break;
    }

    collected.push(line);
  }

  return trimTrailingBlankLines(collected).join("\n");
}

/**
 * Apply the loose length cap. If `text` exceeds `MAX_SECTION_LENGTH`, truncate
 * to the cap and append a continuation marker; otherwise return it unchanged.
 */
export function capSectionLength(text: string): string {
  if (text.length <= MAX_SECTION_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_SECTION_LENGTH) + TRUNCATION_MARKER;
}

/** Return the ATX heading level (1–6) for a line, or `null` when not a heading. */
function headingLevel(line: string): number | null {
  const match = atxHeadingPattern.exec(line);
  if (match === null) {
    return null;
  }
  return (match[1] ?? "").length;
}

/**
 * Decide whether a heading at `level` ends a section started at `startLevel`.
 *
 * A same-or-higher heading (`level <= startLevel`) terminates. When the start
 * line was not a heading (`startLevel === null`), any heading terminates.
 */
function terminatesSection(startLevel: number | null, level: number): boolean {
  if (startLevel === null) {
    return true;
  }
  return level <= startLevel;
}

/** Match the fence-close rule used by `src/core/markdown.ts`. */
function isFenceClose(line: string, marker: "`" | "~" | null): boolean {
  if (marker === "`") {
    return /^ {0,3}`{3,}\s*$/.test(line);
  }
  if (marker === "~") {
    return /^ {0,3}~{3,}\s*$/.test(line);
  }
  return false;
}

/** Drop trailing blank (whitespace-only) lines from a collected section. */
function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}
