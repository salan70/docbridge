import type { SpecLinkDiagnostic, Summary } from "./types";

/**
 * @doc docs/specs/diagnostics.md#sorting-diagnostics
 */
export function sortDiagnostics(
  diagnostics: SpecLinkDiagnostic[],
): SpecLinkDiagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}

export function summarizeDiagnostics(
  diagnostics: SpecLinkDiagnostic[],
): Summary {
  return diagnostics.reduce<Summary>(
    (summary, diagnostic) => {
      if (diagnostic.severity === "error") {
        return {
          ...summary,
          errors: summary.errors + 1,
        };
      }

      return {
        ...summary,
        warnings: summary.warnings + 1,
      };
    },
    {
      errors: 0,
      warnings: 0,
    },
  );
}

export function formatDiagnostic(diagnostic: SpecLinkDiagnostic): string {
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

function compareDiagnostics(
  left: SpecLinkDiagnostic,
  right: SpecLinkDiagnostic,
): number {
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

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
