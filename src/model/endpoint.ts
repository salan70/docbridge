import type { CodeSymbolEndpoint, DocAnchorEndpoint, Range } from "./types";

type EndpointOrderKey = {
  filePath: string;
  line: number;
  column: number;
  endpoint: string;
};

/** Return the file portion of a canonical `file#fragment` endpoint. */
export function filePathOf(endpoint: string): string {
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(0, hashIndex);
}

/** Return the fragment portion of a canonical `file#fragment` endpoint. */
export function fragmentOf(endpoint: string): string {
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(hashIndex + 1);
}

/** Compare endpoints by file, source position, then canonical endpoint. */
export function compareEndpointOrder(left: EndpointOrderKey, right: EndpointOrderKey): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.column - right.column ||
    left.endpoint.localeCompare(right.endpoint)
  );
}

/** Select the source range used by LSP hover and navigation. */
export function endpointRange(element: CodeSymbolEndpoint | DocAnchorEndpoint): Range {
  const range = element.kind === "code" ? element.nameRange : element.headingTextRange;
  if (range !== undefined) {
    return range;
  }
  const { line, column } = element.location;
  return { start: { line, column }, end: { line, column } };
}
