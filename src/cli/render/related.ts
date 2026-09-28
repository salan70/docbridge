import { pluralize } from "../../model/diagnostics";
import { fragmentOf } from "../../model/endpoint";
import type { RelatedGateViolation, RelatedResult, RelatedSummary } from "../../query/related";

/**
 * Render a `RelatedResult` as the human-readable `docbridge related` report:
 * one block per changed file with links, one `fragment -> endpoint (mark)`
 * line per counterpart, then the summary line.
 */
export function formatRelatedResult(result: RelatedResult): string {
  const lines: string[] = [];
  for (const file of result.files) {
    lines.push(file.filePath);
    for (const endpoint of file.endpoints) {
      const fragment = fragmentOf(endpoint.endpoint);
      for (const counterpart of endpoint.counterparts) {
        const mark = counterpart.inChangeSet ? "in change set" : "not in change set";
        lines.push(`  ${fragment} -> ${counterpart.endpoint} (${mark})`);
      }
    }
    lines.push("");
  }
  lines.push(formatRelatedSummary(result.summary));
  return lines.join("\n");
}

/**
 * Render gate violations as the human-readable `docbridge related --gate`
 * report: one `changed -> counterpart` line per violation, then the summary.
 */
export function formatGateResult(
  result: RelatedResult,
  violations: RelatedGateViolation[],
): string {
  const lines: string[] = [];
  for (const violation of violations) {
    lines.push(
      `${violation.changedEndpoint} -> ${violation.counterpartEndpoint} (counterpart not in change set)`,
    );
  }
  if (violations.length > 0) {
    lines.push("");
  }
  lines.push(formatGateSummary(result.summary.changedFiles, violations.length));
  return lines.join("\n");
}

function formatGateSummary(changedFiles: number, violations: number): string {
  return `${changedFiles} changed ${pluralize("file", changedFiles)}, ${violations} ${pluralize("counterpart", violations)} not in change set`;
}

function formatRelatedSummary(summary: RelatedSummary): string {
  return `${summary.changedFiles} changed ${pluralize("file", summary.changedFiles)}, ${summary.filesWithLinks} with links`;
}
