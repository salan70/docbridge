import { pluralize } from "../../model/diagnostics";
import { fragmentOf } from "../../model/endpoint";
import {
  compareNodes,
  comparePairs,
  type GraphPair,
  type GraphResult,
  type GraphSummary,
} from "../../query/graph-output";

export function formatGraphResult(result: GraphResult, inputFiles: string[]): string {
  const lines: string[] = [];
  if (inputFiles.length === 0) {
    appendDocsOrientedLines(lines, result);
  } else {
    appendScopedLines(lines, result, inputFiles);
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(formatGraphSummary(result.summary));
  return lines.join("\n");
}

function appendDocsOrientedLines(lines: string[], result: GraphResult): void {
  const docs = result.nodes.filter((node) => node.kind === "doc").toSorted(compareNodes);
  for (const doc of docs) {
    const pairs = result.pairs.filter((pair) => pair.docEndpoint === doc.endpoint);
    if (pairs.length === 0) {
      continue;
    }
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(doc.filePath);
    for (const pair of pairs.toSorted(comparePairs)) {
      lines.push(`  ${fragmentOf(pair.docEndpoint)} -> ${pair.codeEndpoint} (${pairStatus(pair)})`);
    }
  }
}

function appendScopedLines(lines: string[], result: GraphResult, inputFiles: string[]): void {
  const inputSet = new Set(inputFiles);
  const nodes = result.nodes.filter((node) => inputSet.has(node.filePath)).toSorted(compareNodes);
  for (const node of nodes) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(node.filePath);
    const pairs = result.pairs.filter(
      (pair) => pair.codeEndpoint === node.endpoint || pair.docEndpoint === node.endpoint,
    );
    for (const pair of pairs.toSorted(comparePairs)) {
      if (node.kind === "doc") {
        lines.push(
          `  ${fragmentOf(pair.docEndpoint)} -> ${pair.codeEndpoint} (${pairStatus(pair)})`,
        );
      } else {
        lines.push(
          `  ${fragmentOf(pair.codeEndpoint)} -> ${pair.docEndpoint} (${pairStatus(pair)})`,
        );
      }
    }
  }
}

function formatGraphSummary(summary: GraphSummary): string {
  return [
    `${summary.nodes} ${pluralize("node", summary.nodes)}`,
    `${summary.edges} ${pluralize("edge", summary.edges)}`,
    `${summary.bidirectionalPairs} bidirectional ${pluralize("pair", summary.bidirectionalPairs)}`,
    `${summary.oneWayEdges} one-way ${pluralize("edge", summary.oneWayEdges)}`,
    `${summary.diagnostics} ${pluralize("diagnostic", summary.diagnostics)}`,
  ].join(", ");
}

function pairStatus(pair: GraphPair): string {
  if (pair.hasDocEdge && pair.hasCodeEdge) {
    return "bidirectional";
  }
  return pair.hasDocEdge ? "missing @code backlink" : "missing @doc backlink";
}
