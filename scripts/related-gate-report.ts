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
 * Render the gate report: every violation as one `changed -> counterpart` line,
 * followed by the content of each flagged counterpart. Files that are staged
 * *and* carry further unstaged edits are always named, even when no violation
 * was found, because the scan reads the working tree rather than the index (see
 * `gateReport`). Returns the empty string when there is nothing to report, so
 * the caller stays silent.
 */
export function formatGateReport(
  violations: RelatedGateViolation[],
  contexts: ContextBlock[],
  partiallyStagedFiles: string[],
): string {
  const parts: string[] = [];

  if (violations.length > 0) {
    parts.push(
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
    );

    const flagged = new Set(violations.map((violation) => violation.counterpartEndpoint));
    const blocks = contexts
      .filter((block) => flagged.has(block.endpoint))
      .map((block) => renderContextBlock(block));
    if (blocks.length > 0) {
      parts.push(
        [
          "Flagged counterpart content (via `docbridge context`):",
          "",
          blocks.join("\n\n---\n\n"),
        ].join("\n"),
      );
    }
  }

  if (partiallyStagedFiles.length > 0) {
    parts.push(
      [
        "DocBridge related-gate: this report read the working tree, not the index, so its verdict is unreliable for these partially staged files — it can miss a staged link or invent one that is not being committed:",
        "",
        ...partiallyStagedFiles.map((file) => `${file} (also has unstaged changes)`),
        "",
        "Stage the rest of each file, or re-check the counterparts by hand.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

/**
 * Build the gate report for a change set. The change set names staged files,
 * but the scan reads the working tree, so `partiallyStagedFiles` records where
 * the two can disagree; `formatGateReport` reports that separately.
 *
 * Scanning failures (an unreadable or invalid configuration) yield an empty
 * report rather than an error: this is an awareness surface, and `just verify`
 * already owns the hard verdict.
 */
export function gateReport(
  projectRoot: string,
  changedFiles: string[],
  partiallyStagedFiles: string[] = [],
): string {
  const relatedOutcome = related({ projectRoot, changedFiles });
  if (!relatedOutcome.ok) {
    return formatGateReport([], [], partiallyStagedFiles);
  }

  const violations = collectGateViolations(relatedOutcome.result);
  if (violations.length === 0) {
    return formatGateReport([], [], partiallyStagedFiles);
  }

  const contextOutcome = context({ projectRoot, inputFiles: changedFiles });
  return formatGateReport(
    violations,
    contextOutcome.ok ? contextOutcome.result.contexts : [],
    partiallyStagedFiles,
  );
}

/** Staged files that also carry unstaged working-tree edits, in input order. */
function partiallyStaged(projectRoot: string, changedFiles: string[]): string[] {
  const result = Bun.spawnSync({
    cmd: ["git", "diff", "--name-only"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return [];
  }
  const unstaged = new Set(parseChangedFiles(new TextDecoder().decode(result.stdout)));
  return changedFiles.filter((file) => unstaged.has(file));
}

if (import.meta.main) {
  const changedFiles = parseChangedFiles(await Bun.stdin.text());
  const report = gateReport(repoRoot, changedFiles, partiallyStaged(repoRoot, changedFiles));
  if (report !== "") {
    console.error(report);
  }
}
