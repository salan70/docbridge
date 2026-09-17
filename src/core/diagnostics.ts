import type { DocBridgeDiagnostic, Summary } from "./types";

/**
 * @doc docs/specs/diagnostics.md#sorting-diagnostics
 */
export function sortDiagnostics(diagnostics: DocBridgeDiagnostic[]): DocBridgeDiagnostic[] {
  return [...diagnostics].toSorted(compareDiagnostics);
}

export function summarizeDiagnostics(diagnostics: DocBridgeDiagnostic[]): Summary {
  const summary: Summary = { errors: 0, warnings: 0 };
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      summary.errors += 1;
    } else {
      summary.warnings += 1;
    }
  }
  return summary;
}

export function formatDiagnostic(diagnostic: DocBridgeDiagnostic): string {
  const location = diagnostic.location;
  if (location === undefined) {
    return `${diagnostic.target} ${diagnostic.severity} ${diagnostic.code} - ${diagnostic.message}`;
  }

  const prefix = `${location.filePath}:${location.line}:${location.column}`;
  return `${prefix} ${diagnostic.severity} ${diagnostic.code} ${diagnostic.target} - ${diagnostic.message}`;
}

export function formatSummary(summary: Summary): string {
  return `Summary: ${summary.errors} ${pluralize("error", summary.errors)}, ${summary.warnings} ${pluralize("warning", summary.warnings)}`;
}

/**
 * Collect the files whose scan result is incomplete because reading, parsing,
 * or the scanner worker failed.
 *
 * Anything derived from such a file would describe the failure rather than the
 * project, so link resolution and manifest application both suppress
 * diagnostics that touch these files.
 */
export function collectErroredFiles(diagnostics: DocBridgeDiagnostic[]): Set<string> {
  const errored = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.code === "file_read_error" ||
      diagnostic.code === "code_parse_error" ||
      isFileScopedScannerDiagnostic(diagnostic)
    ) {
      errored.add(diagnostic.target);
    }
  }
  return errored;
}

/** Whether a scanner diagnostic names one file rather than the whole language. */
function isFileScopedScannerDiagnostic(diagnostic: DocBridgeDiagnostic): boolean {
  return (
    (diagnostic.code === "code_scanner_unavailable" || diagnostic.code === "code_scanner_failed") &&
    diagnostic.language !== undefined &&
    diagnostic.target !== diagnostic.language
  );
}

function compareDiagnostics(left: DocBridgeDiagnostic, right: DocBridgeDiagnostic): number {
  const leftLocation = left.location;
  const rightLocation = right.location;

  if (leftLocation === undefined && rightLocation !== undefined) {
    return -1;
  }
  if (leftLocation !== undefined && rightLocation === undefined) {
    return 1;
  }

  if (leftLocation !== undefined && rightLocation !== undefined) {
    return (
      compareString(leftLocation.filePath, rightLocation.filePath) ||
      compareNumber(leftLocation.line, rightLocation.line) ||
      compareNumber(leftLocation.column, rightLocation.column) ||
      compareString(left.code, right.code) ||
      compareString(left.target, right.target)
    );
  }

  return compareString(left.code, right.code) || compareString(left.target, right.target);
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

/** Append `s` to `word` unless `count` is exactly one. */
export function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
