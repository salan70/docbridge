export type FenceMarker = "`" | "~";

type AtxHeadingMatch = {
  indent: string;
  hashes: string;
  gap: string;
  rest: string;
};

const atxHeadingPattern = /^(?<indent> {0,3})(?<hashes>#{1,6})(?:(?<gap>[ \t]+)(?<rest>.*))?$/;
const fenceOpenPattern = /^ {0,3}(?:`{3,}|~{3,})/;

/** Parse one ATX heading using DocBridge's shared Markdown rules. */
export function matchAtxHeading(line: string): AtxHeadingMatch | null {
  const match = atxHeadingPattern.exec(line);
  if (match?.groups === undefined) {
    return null;
  }
  return {
    indent: match.groups.indent ?? "",
    hashes: match.groups.hashes ?? "",
    gap: match.groups.gap ?? "",
    rest: match.groups.rest ?? "",
  };
}

/** Return the ATX heading level, or `null` when the line is not a heading. */
export function headingLevel(line: string): number | null {
  return matchAtxHeading(line)?.hashes.length ?? null;
}

/** Return the fence marker when a line opens a fenced code block. */
export function fenceMarkerOf(line: string): FenceMarker | null {
  if (!fenceOpenPattern.test(line)) {
    return null;
  }
  return line.trimStart().startsWith("`") ? "`" : "~";
}

/** Match a closing fence for the active marker. */
export function isFenceClose(line: string, marker: FenceMarker | null): boolean {
  if (marker === "`") {
    return /^ {0,3}`{3,}\s*$/.test(line);
  }
  if (marker === "~") {
    return /^ {0,3}~{3,}\s*$/.test(line);
  }
  return false;
}
