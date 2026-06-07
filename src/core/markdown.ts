import { parseLinkTarget } from "./links";
import type {
  CodeLinkAnnotation,
  DocAnchorEndpoint,
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
};

const atxHeadingPattern = /^(?<indent> {0,3})(?<hashes>#{1,6})(?:[ \t]+(?<rest>.*))?$/;
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
  const rest = match.groups.rest ?? "";
  const headingText = stripClosingHashes(rest).trim();
  const anchor = toAnchor(headingText);

  return {
    anchor,
    headingText,
    location: { filePath, line: lineNumber, column: indent.length + 1 },
  };
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

  return {
    rawTarget,
    location: { filePath, line: lineNumber, column: indentWidth(line) + 1 },
  };
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

  anchors.push({
    kind: "doc",
    filePath,
    anchor: heading.anchor,
    endpoint,
    headingText: heading.headingText,
    location: heading.location,
  });

  if (seenAnchors.has(heading.anchor)) {
    diagnostics.push({
      severity: "error",
      code: "duplicate_doc_anchor",
      target: endpoint,
      message: `Duplicate doc anchor "${heading.anchor}" in ${filePath}.`,
      location: heading.location,
    });
  } else {
    seenAnchors.add(heading.anchor);
  }

  const seenLinkTargets = new Set<string>();
  for (const comment of pending) {
    const parsed = parseLinkTarget(comment.rawTarget, {
      source: endpoint,
      location: comment.location,
    });

    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }

    const target = comment.rawTarget;
    if (seenLinkTargets.has(target)) {
      diagnostics.push({
        severity: "warning",
        code: "duplicate_link",
        source: endpoint,
        target,
        message: `Duplicate @code link from ${endpoint} to ${target}.`,
        location: comment.location,
      });
    } else {
      seenLinkTargets.add(target);
    }

    links.push({
      direction: "doc-to-code",
      source: endpoint,
      target,
      location: comment.location,
    });
  }
}

function flushDangling(
  pending: PendingComment[],
  diagnostics: SpecLinkDiagnostic[],
): void {
  for (const comment of pending) {
    const parsed = parseLinkTarget(comment.rawTarget, {
      location: comment.location,
    });

    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }

    diagnostics.push({
      severity: "warning",
      code: "dangling_code_annotation",
      target: comment.rawTarget,
      message: "@code annotation is not attached to a following heading.",
      location: comment.location,
    });
  }
}

function flushDanglingEmptyHeading(
  pending: PendingComment[],
  diagnostics: SpecLinkDiagnostic[],
): void {
  for (const comment of pending) {
    const parsed = parseLinkTarget(comment.rawTarget, {
      location: comment.location,
    });

    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }

    diagnostics.push({
      severity: "warning",
      code: "dangling_code_annotation",
      target: comment.rawTarget,
      message: "@code annotation is attached to an empty heading that has no anchor.",
      location: comment.location,
    });
  }
}
