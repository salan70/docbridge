import { collectCodeFiles, scanCodeFiles, type CodeInclude } from "./code-language";
import type { CodeScanResult } from "./code-scanner";
import { loadConfig } from "./config";
import { sortDiagnostics } from "./diagnostics";
import { collectFiles, readManagedFile } from "./glob";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
import { normalizeChangedPaths } from "./related";
import { resolveLinks } from "./resolver";
import { extractDocSection } from "./section";
import type {
  CodeLanguage,
  CodeLinkAnnotation,
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  DocLinkAnnotation,
  Range,
  SourceLocation,
  DocBridgeDiagnostic,
} from "./types";

export type GraphNode = {
  id: string;
  kind: "code" | "doc";
  endpoint: string;
  filePath: string;
  language?: CodeLanguage;
  location: SourceLocation;
  range?: Range;
  content?: GraphNodeContent;
};

export type GraphNodeContent =
  | {
      kind: "code";
      symbolName: string;
      signature: string;
    }
  | {
      kind: "doc";
      headingText: string;
    };

export type GraphEdge = {
  kind: "doc" | "code";
  source: string;
  target: string;
  location: SourceLocation;
  range?: Range;
};

export type GraphPair = {
  codeEndpoint: string;
  docEndpoint: string;
  hasDocEdge: boolean;
  hasCodeEdge: boolean;
};

export type GraphSummary = {
  nodes: number;
  edges: number;
  codeNodes: number;
  docNodes: number;
  bidirectionalPairs: number;
  oneWayEdges: number;
  diagnostics: number;
};

export type GraphResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pairs: GraphPair[];
  diagnostics: DocBridgeDiagnostic[];
  summary: GraphSummary;
};

export type GraphOptions = {
  projectRoot: string;
  inputFiles?: string[];
  includeContent?: boolean;
};

export type GraphOutcome =
  | { ok: true; result: GraphResult }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

type ScanData = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  diagnostics: DocBridgeDiagnostic[];
  contentByFile: Map<string, string>;
};

/**
 * Build the machine-readable DocBridge graph for the project, optionally scoped
 * to input files and their direct counterparts.
 *
 * @doc docs/specs/cli.md#graph-command
 */
export function graph(options: GraphOptions): GraphOutcome {
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const scan = scanManagedFiles(options.projectRoot, configResult.config.include);
  const relationshipDiagnostics = resolveLinks({
    codeFiles: scan.codeFiles,
    docFiles: scan.docFiles,
    scanDiagnostics: scan.diagnostics,
    audit: false,
  });
  const diagnostics = sortDiagnostics([...scan.diagnostics, ...relationshipDiagnostics]);

  const inputFiles =
    options.inputFiles === undefined
      ? []
      : normalizeChangedPaths(options.projectRoot, options.inputFiles);
  const result = computeGraphResult({
    ...scan,
    diagnostics,
    inputFiles,
    includeContent: options.includeContent ?? false,
  });

  return { ok: true, result };
}

type ComputeGraphOptions = ScanData & {
  inputFiles: string[];
  includeContent: boolean;
};

export function computeGraphResult(options: ComputeGraphOptions): GraphResult {
  const codeByEndpoint = new Map<string, CodeSymbolEndpoint>();
  for (const file of options.codeFiles) {
    for (const symbol of file.symbols) {
      codeByEndpoint.set(symbol.endpoint, symbol);
    }
  }

  const docByEndpoint = new Map<string, DocAnchorEndpoint>();
  for (const file of options.docFiles) {
    for (const anchor of file.anchors) {
      docByEndpoint.set(anchor.endpoint, anchor);
    }
  }

  const allEdges: GraphEdge[] = [];
  for (const file of options.codeFiles) {
    for (const link of file.links) {
      if (codeByEndpoint.has(link.source) && docByEndpoint.has(link.target)) {
        allEdges.push(edgeFromDocLink(link));
      }
    }
  }
  for (const file of options.docFiles) {
    for (const link of file.links) {
      if (docByEndpoint.has(link.source) && codeByEndpoint.has(link.target)) {
        allEdges.push(edgeFromCodeLink(link));
      }
    }
  }
  allEdges.sort(compareEdges);

  const includedEdges = filterEdges(allEdges, options.inputFiles);
  const includedEndpoints = new Set<string>();
  for (const edge of includedEdges) {
    includedEndpoints.add(edge.source);
    includedEndpoints.add(edge.target);
  }

  const nodes = [...includedEndpoints]
    .map((endpoint) => {
      const code = codeByEndpoint.get(endpoint);
      if (code !== undefined) {
        return codeNode(code, options.contentByFile, options.includeContent);
      }
      const doc = docByEndpoint.get(endpoint);
      if (doc !== undefined) {
        return docNode(doc, options.contentByFile, options.includeContent);
      }
      return undefined;
    })
    .filter((node): node is GraphNode => node !== undefined)
    .toSorted(compareNodes);

  const pairs = computePairs(includedEdges).toSorted(comparePairs);
  const diagnostics = filterDiagnostics(options.diagnostics, nodes, options.inputFiles);

  const bidirectionalPairs = pairs.filter((pair) => pair.hasDocEdge && pair.hasCodeEdge).length;
  const oneWayEdges = pairs.filter((pair) => pair.hasDocEdge !== pair.hasCodeEdge).length;
  const codeNodes = nodes.filter((node) => node.kind === "code").length;
  const docNodes = nodes.filter((node) => node.kind === "doc").length;

  return {
    nodes,
    edges: includedEdges,
    pairs,
    diagnostics,
    summary: {
      nodes: nodes.length,
      edges: includedEdges.length,
      codeNodes,
      docNodes,
      bidirectionalPairs,
      oneWayEdges,
      diagnostics: diagnostics.length,
    },
  };
}

export function formatGraphResult(result: GraphResult, inputFiles: string[] = []): string {
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

function scanManagedFiles(
  projectRoot: string,
  include: { code: CodeInclude; docs: string[] },
): ScanData {
  const diagnostics: DocBridgeDiagnostic[] = [];
  const contentByFile = new Map<string, string>();

  const codeScan = scanCodeFiles(
    projectRoot,
    collectCodeFiles(projectRoot, include.code),
    include.code,
    (relPath) => readManagedFile(projectRoot, relPath),
    (relPath, content) => contentByFile.set(relPath, content),
  );
  const codeFiles = codeScan.codeFiles;
  diagnostics.push(...codeScan.diagnostics);

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectFiles(projectRoot, include.docs)) {
    const read = readManagedFile(projectRoot, relPath);
    if (!read.ok) {
      diagnostics.push(read.diagnostic);
      continue;
    }
    contentByFile.set(relPath, read.content);
    const scan = scanMarkdown(relPath, read.content);
    diagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  return { codeFiles, docFiles, diagnostics, contentByFile };
}

function edgeFromDocLink(link: DocLinkAnnotation): GraphEdge {
  const edge: GraphEdge = {
    kind: "doc",
    source: link.source,
    target: link.target,
    location: link.location,
  };
  if (link.targetRange !== undefined) {
    edge.range = link.targetRange;
  }
  return edge;
}

function edgeFromCodeLink(link: CodeLinkAnnotation): GraphEdge {
  const edge: GraphEdge = {
    kind: "code",
    source: link.source,
    target: link.target,
    location: link.location,
  };
  if (link.targetRange !== undefined) {
    edge.range = link.targetRange;
  }
  return edge;
}

function filterEdges(edges: GraphEdge[], inputFiles: string[]): GraphEdge[] {
  if (inputFiles.length === 0) {
    return edges;
  }
  const inputSet = new Set(inputFiles);
  return edges.filter(
    (edge) => inputSet.has(filePathOf(edge.source)) || inputSet.has(filePathOf(edge.target)),
  );
}

function filterDiagnostics(
  diagnostics: DocBridgeDiagnostic[],
  nodes: GraphNode[],
  inputFiles: string[],
): DocBridgeDiagnostic[] {
  if (inputFiles.length === 0) {
    return diagnostics;
  }
  const includedFiles = new Set(nodes.map((node) => node.filePath));
  for (const file of inputFiles) {
    includedFiles.add(file);
  }
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.location === undefined) {
      return true;
    }
    return includedFiles.has(diagnostic.location.filePath);
  });
}

function codeNode(
  symbol: CodeSymbolEndpoint,
  contentByFile: Map<string, string>,
  includeContent: boolean,
): GraphNode {
  const node: GraphNode = {
    id: symbol.endpoint,
    kind: "code",
    endpoint: symbol.endpoint,
    filePath: symbol.filePath,
    language: symbol.language,
    location: symbol.location,
  };
  const range = symbol.signatureRange ?? symbol.declarationRange;
  if (range !== undefined) {
    node.range = range;
  }
  if (includeContent) {
    node.content = {
      kind: "code",
      symbolName: symbol.symbolName,
      signature: extractSignature(contentByFile.get(symbol.filePath), range),
    };
  }
  return node;
}

function docNode(
  anchor: DocAnchorEndpoint,
  contentByFile: Map<string, string>,
  includeContent: boolean,
): GraphNode {
  const node: GraphNode = {
    id: anchor.endpoint,
    kind: "doc",
    endpoint: anchor.endpoint,
    filePath: anchor.filePath,
    location: anchor.location,
  };
  const sectionRange = docSectionRange(contentByFile.get(anchor.filePath), anchor.location.line);
  if (sectionRange !== undefined) {
    node.range = sectionRange;
  } else if (anchor.headingTextRange !== undefined) {
    node.range = anchor.headingTextRange;
  }
  if (includeContent) {
    node.content = {
      kind: "doc",
      headingText: anchor.headingText,
    };
  }
  return node;
}

function docSectionRange(content: string | undefined, startLine: number): Range | undefined {
  if (content === undefined) {
    return undefined;
  }
  const section = extractDocSection(content, startLine);
  if (section === "") {
    return undefined;
  }
  const lines = section.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    start: { line: startLine, column: 1 },
    end: { line: startLine + lines.length - 1, column: lastLine.length + 1 },
  };
}

function extractSignature(content: string | undefined, range: Range | undefined): string {
  if (content === undefined || range === undefined) {
    return "";
  }
  const lines = content.split("\n").slice(range.start.line - 1, range.end.line);
  const first = lines[0];
  if (first !== undefined) {
    lines[0] = first.slice(range.start.column - 1);
  }
  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];
  if (last !== undefined && range.end.column > 1) {
    lines[lastIndex] = last.slice(0, range.end.column - 1);
  }
  const declaration = lines.join("\n");
  const bodyStart = declaration.indexOf("{");
  if (bodyStart === -1) {
    return declaration.trimEnd();
  }
  return `${declaration.slice(0, bodyStart).trimEnd()} {}`;
}

function computePairs(edges: GraphEdge[]): GraphPair[] {
  const byKey = new Map<string, GraphPair>();
  for (const edge of edges) {
    const codeEndpoint = edge.kind === "doc" ? edge.source : edge.target;
    const docEndpoint = edge.kind === "doc" ? edge.target : edge.source;
    const key = `${codeEndpoint}\0${docEndpoint}`;
    const pair =
      byKey.get(key) ??
      ({
        codeEndpoint,
        docEndpoint,
        hasDocEdge: false,
        hasCodeEdge: false,
      } satisfies GraphPair);
    if (edge.kind === "doc") {
      pair.hasDocEdge = true;
    } else {
      pair.hasCodeEdge = true;
    }
    byKey.set(key, pair);
  }
  return [...byKey.values()];
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
    `${summary.nodes} ${word(summary.nodes, "node")}`,
    `${summary.edges} ${word(summary.edges, "edge")}`,
    `${summary.bidirectionalPairs} bidirectional ${word(summary.bidirectionalPairs, "pair")}`,
    `${summary.oneWayEdges} one-way ${word(summary.oneWayEdges, "edge")}`,
    `${summary.diagnostics} ${word(summary.diagnostics, "diagnostic")}`,
  ].join(", ");
}

function pairStatus(pair: GraphPair): string {
  if (pair.hasDocEdge && pair.hasCodeEdge) {
    return "bidirectional";
  }
  return pair.hasDocEdge ? "missing @code backlink" : "missing @doc backlink";
}

function word(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function filePathOf(endpoint: string): string {
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(0, hashIndex);
}

function fragmentOf(endpoint: string): string {
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(hashIndex + 1);
}

function compareNodes(left: GraphNode, right: GraphNode): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column ||
    left.endpoint.localeCompare(right.endpoint)
  );
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    left.location.filePath.localeCompare(right.location.filePath) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column ||
    left.kind.localeCompare(right.kind) ||
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target)
  );
}

function comparePairs(left: GraphPair, right: GraphPair): number {
  return (
    left.docEndpoint.localeCompare(right.docEndpoint) ||
    left.codeEndpoint.localeCompare(right.codeEndpoint)
  );
}
