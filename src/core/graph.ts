import type { MarkdownScanResult } from "./markdown";
import type { TypeScriptScanResult } from "./typescript";
import type { CodeSymbolEndpoint, DocAnchorEndpoint } from "./types";

export type GraphEndpoint = CodeSymbolEndpoint | DocAnchorEndpoint;

/**
 * The resolved SpecLink link graph: every scanned endpoint plus the symmetric
 * counterpart relation that navigation traverses.
 *
 * Navigation honors resolvable one-way links: an annotation contributes a
 * counterpart edge whenever its target resolves to an existing file and
 * anchor/symbol, regardless of whether the reverse backlink exists. Backlink
 * completeness is reported by diagnostics, not by this graph.
 *
 * @doc docs/specs/lsp.md#navigation-and-resolvable-one-way-links
 */
export type LinkGraph = {
  /** Code symbols keyed by `file#name` endpoint (first occurrence wins). */
  codeByEndpoint: Map<string, CodeSymbolEndpoint>;
  /** Doc anchors keyed by `file#anchor` endpoint (first occurrence wins). */
  docByEndpoint: Map<string, DocAnchorEndpoint>;
  /**
   * Undirected counterpart relation. The graph is bipartite: a code endpoint's
   * counterparts are doc endpoints and vice versa. Keyed by endpoint string.
   */
  counterparts: Map<string, Set<string>>;
};

/**
 * Build the link graph from scanner outputs. Code `@doc` links and Markdown
 * `@code` links each add a symmetric counterpart edge when their target
 * resolves to a known endpoint.
 */
export function buildLinkGraph(
  codeFiles: TypeScriptScanResult[],
  docFiles: MarkdownScanResult[],
): LinkGraph {
  const codeByEndpoint = new Map<string, CodeSymbolEndpoint>();
  for (const file of codeFiles) {
    for (const symbol of file.symbols) {
      if (!codeByEndpoint.has(symbol.endpoint)) {
        codeByEndpoint.set(symbol.endpoint, symbol);
      }
    }
  }

  const docByEndpoint = new Map<string, DocAnchorEndpoint>();
  for (const file of docFiles) {
    for (const anchor of file.anchors) {
      if (!docByEndpoint.has(anchor.endpoint)) {
        docByEndpoint.set(anchor.endpoint, anchor);
      }
    }
  }

  const counterparts = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    addTo(counterparts, a, b);
    addTo(counterparts, b, a);
  };

  // Code `@doc` links (code -> doc): include when the doc anchor resolves.
  for (const file of codeFiles) {
    for (const link of file.links) {
      if (codeByEndpoint.has(link.source) && docByEndpoint.has(link.target)) {
        addEdge(link.source, link.target);
      }
    }
  }

  // Markdown `@code` links (doc -> code): include when the code symbol resolves.
  for (const file of docFiles) {
    for (const link of file.links) {
      if (docByEndpoint.has(link.source) && codeByEndpoint.has(link.target)) {
        addEdge(link.source, link.target);
      }
    }
  }

  return { codeByEndpoint, docByEndpoint, counterparts };
}

/**
 * Resolve the counterpart endpoints linked to `endpoint`, as endpoint objects
 * carrying their ranges. The result is deterministically ordered by file path
 * then position so one-to-many pickers are stable.
 */
export function counterpartsOf(
  graph: LinkGraph,
  endpoint: string,
): GraphEndpoint[] {
  const targets = graph.counterparts.get(endpoint);
  if (targets === undefined) {
    return [];
  }

  const resolved: GraphEndpoint[] = [];
  for (const target of targets) {
    const code = graph.codeByEndpoint.get(target);
    if (code !== undefined) {
      resolved.push(code);
      continue;
    }
    const doc = graph.docByEndpoint.get(target);
    if (doc !== undefined) {
      resolved.push(doc);
    }
  }

  return resolved.sort(compareEndpoints);
}

/** Look up a recorded endpoint object (code or doc) by its endpoint string. */
export function endpointObject(
  graph: LinkGraph,
  endpoint: string,
): GraphEndpoint | undefined {
  return graph.codeByEndpoint.get(endpoint) ?? graph.docByEndpoint.get(endpoint);
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, new Set([value]));
    return;
  }
  existing.add(value);
}

function compareEndpoints(left: GraphEndpoint, right: GraphEndpoint): number {
  return (
    compareString(left.location.filePath, right.location.filePath) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column ||
    compareString(left.endpoint, right.endpoint)
  );
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}
