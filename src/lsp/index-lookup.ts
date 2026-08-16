import type { GraphEndpoint, LinkGraph } from "../core/graph";
import type { Position, Range } from "../core/types";
import { rangeContains } from "./position";

type IndexedEndpoint = {
  range: Range;
  endpoint: GraphEndpoint;
};

/**
 * A position-to-endpoint lookup over the link graph's trigger ranges, grouped by
 * file path. Only endpoints with a navigation range (code `nameRange` or doc
 * `headingTextRange`) are indexed.
 *
 * @doc docs/specs/lsp.md#hit-testing
 */
export type PositionIndex = {
  byFile: Map<string, IndexedEndpoint[]>;
};

/** Build the position index from a resolved link graph. */
export function buildPositionIndex(graph: LinkGraph): PositionIndex {
  const byFile = new Map<string, IndexedEndpoint[]>();

  const add = (range: Range | undefined, endpoint: GraphEndpoint): void => {
    if (range === undefined) {
      return;
    }
    addTo(byFile, endpoint.filePath, { range, endpoint });
  };

  for (const symbol of graph.codeByEndpoint.values()) {
    add(symbol.nameRange, symbol);
  }
  for (const anchor of graph.docByEndpoint.values()) {
    add(anchor.headingTextRange, anchor);
  }

  return { byFile };
}

/**
 * Resolve the endpoint whose trigger range contains `position` (1-based) in the
 * given file. Trigger ranges do not overlap, so the first containing range wins.
 * Returns `undefined` for positions on whitespace, parameters, or `#` markers.
 */
export function endpointAt(
  index: PositionIndex,
  filePath: string,
  position: Position,
): GraphEndpoint | undefined {
  const entries = index.byFile.get(filePath);
  if (entries === undefined) {
    return undefined;
  }
  for (const entry of entries) {
    if (rangeContains(entry.range, position)) {
      return entry.endpoint;
    }
  }
  return undefined;
}

function addTo(map: Map<string, IndexedEndpoint[]>, key: string, value: IndexedEndpoint): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
    return;
  }
  existing.push(value);
}
