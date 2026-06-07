import type { SpecLinkDiagnostic } from "../core/types";
import { toLspRange, type LspRange } from "./position";

/** LSP diagnostic severities: error and warning are the only ones SpecLink uses. */
export type LspDiagnosticSeverity = 1 | 2;

/** LSP `Diagnostic` shape (the subset SpecLink produces). */
export type LspDiagnostic = {
  range: LspRange;
  severity: LspDiagnosticSeverity;
  code: string;
  source: string;
  message: string;
};

const SOURCE = "speclink";

/**
 * Map a SpecLink diagnostic to the LSP `Diagnostic` shape. Severity maps
 * error -> 1, warning -> 2. The range is the diagnostic's own range when
 * present, otherwise the whole line at its location, otherwise the document
 * origin.
 *
 * @doc docs/specs/diagnostics.md#lsp-diagnostics
 */
export function toLspDiagnostic(
  diagnostic: SpecLinkDiagnostic,
  lineLengths: number[],
): LspDiagnostic {
  return {
    range: rangeFor(diagnostic, lineLengths),
    severity: diagnostic.severity === "error" ? 1 : 2,
    code: diagnostic.code,
    source: SOURCE,
    message: diagnostic.message,
  };
}

/**
 * Map every diagnostic whose location is in `filePath` to LSP diagnostics,
 * using `content` for the whole-line fallback range. Diagnostics without a
 * location (for example config errors) are not attached to any file.
 */
export function diagnosticsForFile(
  diagnostics: SpecLinkDiagnostic[],
  filePath: string,
  content: string,
): LspDiagnostic[] {
  const lineLengths = content.split("\n").map((line) => line.length);
  const result: LspDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.location?.filePath === filePath) {
      result.push(toLspDiagnostic(diagnostic, lineLengths));
    }
  }
  return result;
}

function rangeFor(
  diagnostic: SpecLinkDiagnostic,
  lineLengths: number[],
): LspRange {
  if (diagnostic.range !== undefined) {
    return toLspRange(diagnostic.range);
  }

  const location = diagnostic.location;
  if (location !== undefined) {
    const line = location.line - 1;
    const lineLength = lineLengths[line] ?? 0;
    return {
      start: { line, character: 0 },
      end: { line, character: lineLength },
    };
  }

  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
