#!/usr/bin/env bun

import { resolve } from "node:path";

import { context, renderContextBlock, type ContextBlock } from "../src/core/context";
import { collectGateViolations, related, type RelatedGateViolation } from "../src/core/related";

const repoRoot = resolve(import.meta.dir, "..");

/** Split a newline-separated changed-file list into trimmed, non-empty paths. */
export function parseChangedFiles(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Render the gate report: every violation as one `changed -> counterpart`
 * line, followed by the content of each flagged counterpart. Returns the empty
 * string when there is nothing to report, so the caller stays silent.
 */
export function formatGateReport(
  violations: RelatedGateViolation[],
  contexts: ContextBlock[],
): string {
  if (violations.length === 0) {
    return "";
  }

  const flagged = new Set(violations.map((violation) => violation.counterpartEndpoint));
  const blocks = contexts
    .filter((block) => flagged.has(block.endpoint))
    .map((block) => renderContextBlock(block));

  const parts = [
    [
      "DocBridge related-gate: staged changes have linked counterparts that are not staged.",
      "",
      ...violations.map(
        (violation) =>
          `${violation.changedEndpoint} -> ${violation.counterpartEndpoint} (counterpart not in change set)`,
      ),
      "",
      "Update each listed counterpart or state why it needs no update. This is informational and does not block the commit; CI re-checks the whole branch on the pull request.",
    ].join("\n"),
  ];

  if (blocks.length > 0) {
    parts.push(
      [
        "Flagged counterpart content (via `docbridge context`):",
        "",
        blocks.join("\n\n---\n\n"),
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

/**
 * Build the gate report for a change set. Scanning failures (an unreadable or
 * invalid configuration) yield an empty report rather than an error: this is
 * an awareness surface, and `just verify` already owns the hard verdict.
 */
export function gateReport(projectRoot: string, changedFiles: string[]): string {
  const relatedOutcome = related({ projectRoot, changedFiles });
  if (!relatedOutcome.ok) {
    return "";
  }

  const violations = collectGateViolations(relatedOutcome.result);
  if (violations.length === 0) {
    return "";
  }

  const contextOutcome = context({ projectRoot, inputFiles: changedFiles });
  return formatGateReport(violations, contextOutcome.ok ? contextOutcome.result.contexts : []);
}

if (import.meta.main) {
  const report = gateReport(repoRoot, parseChangedFiles(await Bun.stdin.text()));
  if (report !== "") {
    console.error(report);
  }
}
