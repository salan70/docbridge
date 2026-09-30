import { counterpartsOf, type GraphEndpoint } from "../link/graph";
import { endpointRange } from "../model/endpoint";
import type { CodeLanguage, Position, Range } from "../model/types";
import { capSectionLength, extractDocSection } from "../scan/markdown/section";
import { sliceSourceRange } from "../shared/source-range";
import { endpointAt } from "./index-lookup";
import type { ProjectState } from "./project";

/** Markdown hover content plus the range of the element it describes. */
type HoverResult = {
  value: string;
  range: Range;
};

const DIVIDER = "\n\n---\n\n";

/**
 * Build hover content for the element at `position`. Code symbols render their
 * linked Markdown section(s) inline; doc headings render the linked code
 * endpoint and its declaration signature. Returns `null` when nothing is
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

  return { value, range: endpointRange(element) };
}

/** Code -> doc: concatenate the linked Markdown sections. */
function renderDocSections(state: ProjectState, counterparts: GraphEndpoint[]): string | null {
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

/** Doc -> code: the linked endpoint plus its declaration signature. */
function renderCodeSignatures(state: ProjectState, counterparts: GraphEndpoint[]): string | null {
  const blocks: string[] = [];
  for (const symbol of counterparts) {
    if (symbol.kind !== "code") {
      continue;
    }
    const content = state.contentByFile.get(symbol.filePath);
    const signature =
      content === undefined || symbol.signatureRange === undefined
        ? ""
        : withoutLeadingComments(
            sliceSourceRange(content, symbol.signatureRange).content,
            symbol.language,
          ).trimEnd();
    const fenced =
      signature.length > 0
        ? `\n\n\`\`\`${FENCE_LANGUAGE[symbol.language]}\n${signature}\n\`\`\``
        : "";
    blocks.push(`**${symbol.endpoint}**${fenced}`);
  }
  return blocks.length > 0 ? blocks.join(DIVIDER) : null;
}

const FENCE_LANGUAGE: Readonly<Record<CodeLanguage, string>> = {
  typescript: "ts",
  swift: "swift",
  dart: "dart",
  rust: "rust",
  go: "go",
};

/** Languages whose block comments nest, so an inner block comment opens a new level. */
const NESTED_BLOCK_COMMENTS: ReadonlySet<CodeLanguage> = new Set(["swift", "dart", "rust"]);

/**
 * Drop the whitespace and comments before a declaration, such as the doc
 * comment that `signatureRange` starts with. Attributes, decorators, and
 * comments inside the declaration stay.
 */
function withoutLeadingComments(text: string, language: CodeLanguage): string {
  let index = 0;
  for (;;) {
    while (index < text.length && /\s/.test(text[index] ?? "")) {
      index += 1;
    }
    if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? text.length : newline + 1;
    } else if (text.startsWith("/*", index)) {
      index = blockCommentEnd(text, index, NESTED_BLOCK_COMMENTS.has(language));
    } else {
      return text.slice(index);
    }
  }
}

/** The offset just past the block comment that opens at `start`. */
function blockCommentEnd(text: string, start: number, nests: boolean): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text.startsWith("/*", index) && (nests || depth === 0)) {
      depth += 1;
      index += 2;
    } else if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        return index;
      }
    } else {
      index += 1;
    }
  }
  return text.length;
}
