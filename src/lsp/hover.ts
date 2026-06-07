import { counterpartsOf, type GraphEndpoint } from "../core/graph";
import type { Position, Range } from "../core/types";
import { endpointAt } from "./index-lookup";
import type { ProjectState } from "./project";
import { capSectionLength, extractDocSection } from "./section";

/** Markdown hover content plus the range of the element it describes. */
export type HoverResult = {
  value: string;
  range: Range;
};

const DIVIDER = "\n\n---\n\n";

/**
 * Build hover content for the element at `position`. Code symbols render their
 * linked Markdown section(s) inline; doc headings render the linked code
 * endpoint and its declaration signature line. Returns `null` when nothing is
 * under the cursor or the element has no resolvable counterpart.
 *
 * @doc docs/specs/lsp.md#hover
 */
export function hover(
  state: ProjectState,
  filePath: string,
  position: Position,
): HoverResult | null {
  const element = endpointAt(state.index, filePath, position);
  if (element === undefined) {
    return null;
  }

  const counterparts = counterpartsOf(state.graph, element.endpoint);
  if (counterparts.length === 0) {
    return null;
  }

  const value =
    element.kind === "code"
      ? renderDocSections(state, counterparts)
      : renderCodeSignatures(state, counterparts);

  if (value === null) {
    return null;
  }

  return { value, range: triggerRange(element) };
}

/** Code -> doc: concatenate the linked Markdown sections. */
function renderDocSections(
  state: ProjectState,
  counterparts: GraphEndpoint[],
): string | null {
  const sections: string[] = [];
  for (const anchor of counterparts) {
    if (anchor.kind !== "doc") {
      continue;
    }
    const content = state.contentByFile.get(anchor.filePath);
    if (content === undefined) {
      continue;
    }
    sections.push(capSectionLength(extractDocSection(content, anchor.location.line)));
  }
  return sections.length > 0 ? sections.join(DIVIDER) : null;
}

/** Doc -> code: the linked endpoint plus its declaration signature line. */
function renderCodeSignatures(
  state: ProjectState,
  counterparts: GraphEndpoint[],
): string | null {
  const blocks: string[] = [];
  for (const symbol of counterparts) {
    if (symbol.kind !== "code") {
      continue;
    }
    const content = state.contentByFile.get(symbol.filePath);
    const signature = content === undefined ? "" : lineAt(content, symbol.location.line).trim();
    const fenced = signature.length > 0 ? `\n\n\`\`\`ts\n${signature}\n\`\`\`` : "";
    blocks.push(`**${symbol.endpoint}**${fenced}`);
  }
  return blocks.length > 0 ? blocks.join(DIVIDER) : null;
}

function triggerRange(element: GraphEndpoint): Range {
  const range = element.kind === "code" ? element.nameRange : element.headingTextRange;
  if (range !== undefined) {
    return range;
  }
  // Endpoints reach hover only through the index, which requires a range, so
  // this fallback is defensive.
  const { line, column } = element.location;
  return { start: { line, column }, end: { line, column } };
}

function lineAt(content: string, line: number): string {
  return content.split("\n")[line - 1] ?? "";
}
