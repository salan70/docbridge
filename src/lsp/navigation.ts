import { counterpartsOf, type GraphEndpoint } from "../core/graph";
import type { Position, Range } from "../core/types";
import { endpointAt } from "./index-lookup";
import type { ProjectState } from "./project";

/** A navigation target: the counterpart file and the range to reveal. */
export type Locator = {
  filePath: string;
  range: Range;
};

/**
 * Go to Definition: the linked counterpart location(s) for the element at
 * `position`. Code resolves to its doc heading(s); a heading resolves to its
 * code declaration(s). One-to-many yields multiple locators.
 *
 * @doc docs/specs/lsp.md#definition
 */
export function definition(
  state: ProjectState,
  filePath: string,
  position: Position,
): Locator[] {
  return counterpartLocators(state, filePath, position);
}

/**
 * Find All References: every counterpart linked to the element at `position`,
 * using the symmetric counterpart model. From a heading, all code symbols that
 * link to it; from a code symbol, all doc sections it links to.
 *
 * @doc docs/specs/lsp.md#references
 */
export function references(
  state: ProjectState,
  filePath: string,
  position: Position,
): Locator[] {
  return counterpartLocators(state, filePath, position);
}

function counterpartLocators(
  state: ProjectState,
  filePath: string,
  position: Position,
): Locator[] {
  const element = endpointAt(state.index, filePath, position);
  if (element === undefined) {
    return [];
  }
  return counterpartsOf(state.graph, element.endpoint).map((counterpart) => ({
    filePath: counterpart.filePath,
    range: elementRange(counterpart),
  }));
}

/** The element range used as a navigation target: name or heading-text range. */
function elementRange(element: GraphEndpoint): Range {
  const range = element.kind === "code" ? element.nameRange : element.headingTextRange;
  if (range !== undefined) {
    return range;
  }
  const { line, column } = element.location;
  return { start: { line, column }, end: { line, column } };
}
