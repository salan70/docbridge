import { pluralize } from "../../model/diagnostics";
import type { CodeLanguage } from "../../model/types";
import type { ContextBlock, ContextResult, ContextSummary } from "../../query/context";

/**
 * Render a `ContextResult` as the `docbridge context` Markdown report: one block
 * per counterpart (doc sections raw, code declarations fenced), separated by
 * horizontal rules, then the summary line. Diagnostics are not rendered here;
 * the CLI reports them on stderr.
 */
export function formatContextResult(result: ContextResult): string {
  const blocks = result.contexts.map(renderContextBlock);
  const summary = formatContextSummary(result.summary);
  if (blocks.length === 0) {
    return summary;
  }
  return `${blocks.join("\n\n---\n\n")}\n\n${summary}`;
}

/**
 * Render one context block: the `endpoint (linked from …)` header, then the
 * content — raw for doc sections, fenced with the code language for code
 * declarations.
 */
export function renderContextBlock(block: ContextBlock): string {
  const header = `${block.endpoint} (linked from ${block.linkedFrom.join(", ")})`;
  if (block.kind !== "code") {
    return `${header}\n\n${block.content}`;
  }
  const fence = codeFence(block.content);
  return `${header}\n\n${fence}${fenceLanguage(block.language)}\n${block.content}\n${fence}`;
}

function fenceLanguage(language: CodeLanguage | undefined): string {
  if (language === "swift") {
    return "swift";
  }
  if (language === "dart") {
    return "dart";
  }
  if (language === "rust") {
    return "rust";
  }
  if (language === "go") {
    return "go";
  }
  return "ts";
}

/** A backtick fence one longer than the longest backtick run in the content. */
function codeFence(content: string): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}

function formatContextSummary(summary: ContextSummary): string {
  return `${summary.inputFiles} input ${pluralize("file", summary.inputFiles)}, ${summary.contexts} context ${pluralize("block", summary.contexts)}`;
}
