import { parseLinkTarget, type ParseLinkTargetOptions } from "./links";
import type {
  CodeLinkAnnotation,
  DocAnchorEndpoint,
  Range,
  SourceLocation,
  SpecLinkDiagnostic,
} from "./types";

export type MarkdownScanResult = {
  filePath: string;
  anchors: DocAnchorEndpoint[];
  links: CodeLinkAnnotation[];
  diagnostics: SpecLinkDiagnostic[];
};

type PendingComment = {
  rawTarget: string;
  location: SourceLocation;
  targetRange?: Range;
};

const atxHeadingPattern =
  /^(?<indent> {0,3})(?<hashes>#{1,6})(?:(?<gap>[ \t]+)(?<rest>.*))?$/;
const fenceOpenPattern = /^ {0,3}(?:`{3,}|~{3,})/;
const htmlCommentPattern = /^ {0,3}<!--(?<body>.*?)-->\s*$/;

/**
 * Scan a Markdown document for heading anchors and `@code` annotations.
 *
 * The function is pure: it derives all results from `filePath` and `content`
 * without touching the filesystem. `filePath` must be project-root-relative.
 *
 * @doc docs/specs/scanning.md#markdown-scanning
 */
export function scanMarkdown(filePath: string, content: string): MarkdownScanResult {
  const anchors: DocAnchorEndpoint[] = [];
  const links: CodeLinkAnnotation[] = [];
  const diagnostics: SpecLinkDiagnostic[] = [];

  const seenAnchors = new Set<string>();
  let pending: PendingComment[] = [];
  let inFence = false;
  let fenceMarker: "`" | "~" | null = null;

  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    // Fenced code blocks toggle scanning of their contents off entirely.
    if (inFence) {
      if (isFenceClose(line, fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }

    if (fenceOpenPattern.test(line)) {
      inFence = true;
      fenceMarker = line.trimStart().startsWith("`") ? "`" : "~";
      continue;
    }

    const comment = matchCodeComment(line, filePath, lineNumber);
    if (comment !== null) {
      pending.push(comment);
      continue;
    }

    if (isCommentLine(line)) {
      // A non-`@code` standalone comment invalidates any pending annotations.
      flushDangling(pending, diagnostics);
      pending = [];
      continue;
    }

    const heading = matchHeading(line, filePath, lineNumber);
    if (heading !== null) {
      if (heading.anchor === "") {
        // Empty headings create no anchor and invalidate pending annotations.
        flushDanglingEmptyHeading(pending, diagnostics);
        pending = [];
        continue;
      }

      attachHeading(heading, anchors, links, diagnostics, seenAnchors, pending, filePath);
      pending = [];
      continue;
    }

    if (line.trim() === "") {
      // Blank lines are allowed between pending comments and a heading.
      continue;
    }

    // Any other non-empty content invalidates pending annotations.
    if (pending.length > 0) {
      flushDangling(pending, diagnostics);
      pending = [];
    }
  }

  // Pending annotations at end of file never attach to a heading.
  flushDangling(pending, diagnostics);

  return { filePath, anchors, links, diagnostics };
}

type HeadingMatch = {
  anchor: string;
  headingText: string;
  location: SourceLocation;
  headingTextRange?: Range;
};

function matchHeading(
  line: string,
  filePath: string,
  lineNumber: number,
): HeadingMatch | null {
  const match = atxHeadingPattern.exec(line);
  if (match?.groups === undefined) {
    return null;
  }

  const indent = match.groups.indent ?? "";
  const hashes = match.groups.hashes ?? "";
  const gap = match.groups.gap ?? "";
  const rest = match.groups.rest ?? "";
  const headingText = stripClosingHashes(rest).trim();
  const anchor = toAnchor(headingText);

  const heading: HeadingMatch = {
    anchor,
    headingText,
    location: { filePath, line: lineNumber, column: indent.length + 1 },
  };

  // The greedy `[ \t]+` gap consumes all leading whitespace, so the heading
  // text begins right after it; `headingText` only strips trailing content.
  if (headingText.length > 0) {
    const textStart = indent.length + hashes.length + gap.length;
    heading.headingTextRange = {
      start: { line: lineNumber, column: textStart + 1 },
      end: { line: lineNumber, column: textStart + headingText.length + 1 },
    };
  }

  return heading;
}

function stripClosingHashes(text: string): string {
  // An optional closing sequence of `#` separated from the text by spaces.
  return text.replace(/[ \t]+#+[ \t]*$/, "").replace(/^#+[ \t]*$/, "");
}

/**
 * Generate a heading anchor using the v0.1 rules:
 * - JavaScript `toLowerCase()`
 * - runs of whitespace and punctuation become a single `-`
 * - leading and trailing `-` are removed
 * - Unicode letters and numbers are preserved
 */
function toAnchor(headingText: string): string {
  const lowered = headingText.toLowerCase();
  const replaced = lowered.replace(/[^\p{L}\p{N}]+/gu, "-");
  return replaced.replace(/^-+/, "").replace(/-+$/, "");
}

function matchCodeComment(
  line: string,
  filePath: string,
  lineNumber: number,
): PendingComment | null {
  const match = htmlCommentPattern.exec(line);
  if (match?.groups === undefined) {
    return null;
  }

  const body = (match.groups.body ?? "").trim();
  if (body !== "@code" && !body.startsWith("@code ") && !body.startsWith("@code\t")) {
    return null;
  }

  const afterTag = body.slice("@code".length).trim();
  const rawTarget = afterTag.split(/\s+/)[0] ?? "";

  const comment: PendingComment = {
    rawTarget,
    location: { filePath, line: lineNumber, column: indentWidth(line) + 1 },
  };

  // Locate the literal target token after the `@code` tag on the source line.
  if (rawTarget.length > 0) {
    const tagIndex = line.indexOf("@code");
    const targetStart = tagIndex === -1 ? -1 : line.indexOf(rawTarget, tagIndex + "@code".length);
    if (targetStart !== -1) {
      comment.targetRange = {
        start: { line: lineNumber, column: targetStart + 1 },
        end: { line: lineNumber, column: targetStart + rawTarget.length + 1 },
      };
    }
  }

  return comment;
}

function isCommentLine(line: string): boolean {
  return htmlCommentPattern.test(line);
}

function indentWidth(line: string): number {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

function isFenceClose(line: string, marker: "`" | "~" | null): boolean {
  if (marker === "`") {
    return /^ {0,3}`{3,}\s*$/.test(line);
  }
  if (marker === "~") {
    return /^ {0,3}~{3,}\s*$/.test(line);
  }
  return false;
}

function attachHeading(
  heading: HeadingMatch,
  anchors: DocAnchorEndpoint[],
  links: CodeLinkAnnotation[],
  diagnostics: SpecLinkDiagnostic[],
  seenAnchors: Set<string>,
  pending: PendingComment[],
  filePath: string,
): void {
  const endpoint = `${filePath}#${heading.anchor}`;

  const anchor: DocAnchorEndpoint = {
    kind: "doc",
    filePath,
    anchor: heading.anchor,
    endpoint,
    headingText: heading.headingText,
    location: heading.location,
  };
  if (heading.headingTextRange !== undefined) {
    anchor.headingTextRange = heading.headingTextRange;
  }
  anchors.push(anchor);

  if (seenAnchors.has(heading.anchor)) {
    const diagnostic: SpecLinkDiagnostic = {
      severity: "error",
      code: "duplicate_doc_anchor",
      target: endpoint,
      message: `Duplicate doc anchor "${heading.anchor}" in ${filePath}.`,
      location: heading.location,
    };
    if (heading.headingTextRange !== undefined) {
      diagnostic.range = heading.headingTextRange;
    }
    diagnostics.push(diagnostic);
  } else {
    seenAnchors.add(heading.anchor);
  }

  const seenLinkTargets = new Set<string>();
  for (const comment of pending) {
    const parsed = parseLinkTarget(comment.rawTarget, parseOptions(comment, endpoint));

    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }

    const target = comment.rawTarget;
    if (seenLinkTargets.has(target)) {
      const diagnostic: SpecLinkDiagnostic = {
        severity: "warning",
        code: "duplicate_link",
        source: endpoint,
        target,
        message: `Duplicate @code link from ${endpoint} to ${target}.`,
        location: comment.location,
      };
      if (comment.targetRange !== undefined) {
        diagnostic.range = comment.targetRange;
      }
      diagnostics.push(diagnostic);
    } else {
      seenLinkTargets.add(target);
    }

    const link: CodeLinkAnnotation = {
      direction: "doc-to-code",
      source: endpoint,
      target,
      location: comment.location,
    };
    if (comment.targetRange !== undefined) {
      link.targetRange = comment.targetRange;
    }
    links.push(link);
  }
}

/** Build parse options for a pending `@code` comment, carrying its target range. */
function parseOptions(
  comment: PendingComment,
  source?: string,
): ParseLinkTargetOptions {
  const options: ParseLinkTargetOptions = { location: comment.location };
  if (source !== undefined) {
    options.source = source;
  }
  if (comment.targetRange !== undefined) {
    options.targetRange = comment.targetRange;
  }
  return options;
}

function flushDangling(
  pending: PendingComment[],
  diagnostics: SpecLinkDiagnostic[],
): void {
  flushDanglingWith(
    pending,
    diagnostics,
    "@code annotation is not attached to a following heading.",
  );
}

function flushDanglingEmptyHeading(
  pending: PendingComment[],
  diagnostics: SpecLinkDiagnostic[],
): void {
  flushDanglingWith(
    pending,
    diagnostics,
    "@code annotation is attached to an empty heading that has no anchor.",
  );
}

function flushDanglingWith(
  pending: PendingComment[],
  diagnostics: SpecLinkDiagnostic[],
  message: string,
): void {
  for (const comment of pending) {
    const parsed = parseLinkTarget(comment.rawTarget, parseOptions(comment));

    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }

    const diagnostic: SpecLinkDiagnostic = {
      severity: "warning",
      code: "dangling_code_annotation",
      target: comment.rawTarget,
      message,
      location: comment.location,
    };
    if (comment.targetRange !== undefined) {
      diagnostic.range = comment.targetRange;
    }
    diagnostics.push(diagnostic);
  }
}
