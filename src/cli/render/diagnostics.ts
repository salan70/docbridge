import { pluralize } from "../../model/diagnostics";
import type { DocBridgeDiagnostic, Summary } from "../../model/types";

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
