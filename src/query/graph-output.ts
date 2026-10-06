import { buildLinkGraph, type LinkGraph } from "../link/graph";
import { resolveLinks } from "../link/resolver";
import { sortDiagnostics } from "../model/diagnostics";
import { compareEndpointOrder, filePathOf } from "../model/endpoint";
import type { CodeScanResult } from "../model/scan-result";
import type { MarkdownScanResult } from "../model/scan-result";
import type {
  CodeLanguage,
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  LinkAnnotation,
  Range,
  SourceLocation,
  DocBridgeDiagnostic,
} from "../model/types";
import { extractDocSection } from "../scan/markdown/section";
import { sliceSourceRange } from "../shared/source-range";
import { scanProject } from "./project-scan";
import { normalizeChangedPaths } from "./related";

type GraphNode = {
  id: string;
  kind: "code" | "doc";
  endpoint: string;
  filePath: string;
  language?: CodeLanguage;
  location: SourceLocation;
  range?: Range;
  content?: GraphNodeContent;
};

type GraphNodeContent =
  | {
      kind: "code";
      symbolName: string;
      signature: string;
    }
  | {
      kind: "doc";
      headingText: string;
    };

type GraphEdge = {
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

type GraphOptions = {
  projectRoot: string;
  inputFiles?: string[];
  includeContent?: boolean;
};

type GraphOutcome =
  | { ok: true; result: GraphResult }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

type ScanData = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  diagnostics: DocBridgeDiagnostic[];
  contentByFile: Map<string, string>;
  graph?: LinkGraph;
};

/**
 * Build the machine-readable DocBridge graph for the project, optionally scoped
 * to input files and their direct counterparts.
 *
 * @doc docs/specs/cli.md#graph-command
 * @doc docs/user/commands.md#graph-inspect-link-structure
 */
export async function graph(options: GraphOptions): Promise<GraphOutcome> {
  const outcome = await scanProject({
    projectRoot: options.projectRoot,
    buildGraph: true,
    keepContent: true,
  }).promise;
  if (!outcome.ok) {
    return { ok: false, diagnostics: outcome.diagnostics };
  }

  const scan = outcome.scan;
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
  const linkGraph = options.graph ?? buildLinkGraph(options.codeFiles, options.docFiles);
  const { codeByEndpoint, docByEndpoint } = linkGraph;

  const allEdges: GraphEdge[] = [];
  for (const file of options.codeFiles) {
    for (const link of file.links) {
      if (linkGraph.counterparts.get(link.source)?.has(link.target) === true) {
        allEdges.push(edgeFromDocLink(link));
      }
    }
  }
  for (const file of options.docFiles) {
    for (const link of file.links) {
      if (linkGraph.counterparts.get(link.source)?.has(link.target) === true) {
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

function edgeFromDocLink(link: LinkAnnotation): GraphEdge {
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

function edgeFromCodeLink(link: LinkAnnotation): GraphEdge {
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
      signature: extractSignature(
        contentByFile.get(symbol.filePath),
        range,
        symbol.signatureRange !== undefined,
      ),
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

/**
 * Render a code node's signature text from `range`.
 *
 * `bodyExcluded` says the range is a `signatureRange`, which every scanner ends
 * at the body's opening brace, so the extracted text is already body-free.
 * Truncating it at its first `{` would instead cut into a signature that
 * legitimately contains one — an object-typed parameter, an object type
 * constraint — and render `login(options: {}`. The truncation exists for the
 * `declarationRange` fallback, whose text does contain the body.
 */
function extractSignature(
  content: string | undefined,
  range: Range | undefined,
  bodyExcluded: boolean,
): string {
  if (content === undefined || range === undefined) {
    return "";
  }
  const declaration = sliceSourceRange(content, range).content;
  const bodyStart = bodyExcluded ? -1 : declaration.indexOf("{");
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

export function compareNodes(left: GraphNode, right: GraphNode): number {
  return compareEndpointOrder(
    { ...left.location, endpoint: left.endpoint },
    { ...right.location, endpoint: right.endpoint },
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

export function comparePairs(left: GraphPair, right: GraphPair): number {
  return (
    left.docEndpoint.localeCompare(right.docEndpoint) ||
    left.codeEndpoint.localeCompare(right.codeEndpoint)
  );
}
