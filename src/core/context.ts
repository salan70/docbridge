import { pluralize, sortDiagnostics } from "./diagnostics";
import { compareEndpointOrder } from "./endpoint";
import { counterpartsOf, type GraphEndpoint, type LinkGraph } from "./graph";
import { scanProject } from "./project-scan";
import { normalizeChangedPaths } from "./related";
import { resolveLinks } from "./resolver";
import { extractDocSection } from "./section";
import { sliceSourceRange } from "./source-range";
import type { EndpointKind, DocBridgeDiagnostic } from "./types";
import type { CodeLanguage } from "./types";

export type ContextBlock = {
  endpoint: string;
  kind: EndpointKind;
  filePath: string;
  language?: CodeLanguage;
  /** 1-based first line of `content` within `filePath`. */
  startLine: number;
  /** 1-based last line of `content` within `filePath`, inclusive. */
  endLine: number;
  /** Endpoints in the input files that link to this counterpart, sorted. */
  linkedFrom: string[];
  content: string;
};

type ContextSummary = {
  inputFiles: number;
  contexts: number;
};

type ContextData = {
  contexts: ContextBlock[];
  summary: ContextSummary;
};

type ContextResult = ContextData & {
  /** Check diagnostics located in the input files, in check order. */
  diagnostics: DocBridgeDiagnostic[];
};

/**
 * Collect the content of every counterpart linked from the given input files:
 * doc counterparts contribute their full Markdown section, code counterparts
 * their full declaration source including the JSDoc block. Counterparts linked
 * from multiple inputs appear once, with every linking endpoint recorded in
 * `linkedFrom`. Counterparts whose content cannot be extracted are skipped.
 */
export function computeContext(
  graph: LinkGraph,
  contentByFile: Map<string, string>,
  inputFiles: string[],
): ContextData {
  const inputSet = new Set(inputFiles);

  const blockByEndpoint = new Map<string, ContextBlock>();
  const linkedFromByEndpoint = new Map<string, Set<string>>();

  for (const endpoint of endpointsIn(graph, inputSet)) {
    for (const counterpart of counterpartsOf(graph, endpoint.endpoint)) {
      let block = blockByEndpoint.get(counterpart.endpoint);
      if (block === undefined) {
        const extracted = extractBlock(counterpart, contentByFile);
        if (extracted === null) {
          continue;
        }
        block = extracted;
        blockByEndpoint.set(counterpart.endpoint, block);
        linkedFromByEndpoint.set(counterpart.endpoint, new Set());
      }
      linkedFromByEndpoint.get(counterpart.endpoint)?.add(endpoint.endpoint);
    }
  }

  const contexts = [...blockByEndpoint.values()].toSorted(compareBlocks);
  for (const block of contexts) {
    block.linkedFrom = [...(linkedFromByEndpoint.get(block.endpoint) ?? [])].toSorted(
      (left, right) => left.localeCompare(right),
    );
  }

  return {
    contexts,
    summary: { inputFiles: inputSet.size, contexts: contexts.length },
  };
}

type ContextOptions = {
  projectRoot: string;
  /** Raw input file paths; normalized with `normalizeChangedPaths`. */
  inputFiles: string[];
};

type ContextOutcome =
  | { ok: true; result: ContextResult }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

/**
 * Full orchestration for `docbridge context`: load config, scan the managed
 * files, build the link graph, and collect the counterpart content of the
 * input files. Extraction is best-effort: check diagnostics located in the
 * input files are reported alongside the blocks that did resolve, and never
 * suppress them.
 *
 * @doc docs/specs/cli.md#context-command
 */
export function context(options: ContextOptions): ContextOutcome {
  const outcome = scanProject({
    projectRoot: options.projectRoot,
    buildGraph: true,
    keepContent: true,
  });
  if (!outcome.ok) {
    return { ok: false, diagnostics: outcome.diagnostics };
  }

  const { codeFiles, docFiles, diagnostics: scanDiagnostics, contentByFile, graph } = outcome.scan;
  const inputFiles = normalizeChangedPaths(options.projectRoot, options.inputFiles);
  const data = computeContext(graph, contentByFile, inputFiles);

  const relationshipDiagnostics = resolveLinks({
    codeFiles,
    docFiles,
    scanDiagnostics,
    audit: false,
  });
  const inputSet = new Set(inputFiles);
  const diagnostics = sortDiagnostics([...scanDiagnostics, ...relationshipDiagnostics]).filter(
    (diagnostic) => diagnostic.location !== undefined && inputSet.has(diagnostic.location.filePath),
  );

  return { ok: true, result: { ...data, diagnostics } };
}

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

/** Every graph endpoint whose file is in the input set, in graph order. */
function endpointsIn(graph: LinkGraph, inputSet: Set<string>): GraphEndpoint[] {
  const endpoints: GraphEndpoint[] = [];
  for (const code of graph.codeByEndpoint.values()) {
    if (inputSet.has(code.filePath)) {
      endpoints.push(code);
    }
  }
  for (const doc of graph.docByEndpoint.values()) {
    if (inputSet.has(doc.filePath)) {
      endpoints.push(doc);
    }
  }
  return endpoints;
}

/** Extract the content block for a counterpart, or `null` when unavailable. */
function extractBlock(
  counterpart: GraphEndpoint,
  contentByFile: Map<string, string>,
): ContextBlock | null {
  const content = contentByFile.get(counterpart.filePath);
  if (content === undefined) {
    return null;
  }

  if (counterpart.kind === "doc") {
    const section = extractDocSection(content, counterpart.location.line);
    if (section === "") {
      return null;
    }
    const startLine = counterpart.location.line;
    return {
      endpoint: counterpart.endpoint,
      kind: "doc",
      filePath: counterpart.filePath,
      startLine,
      endLine: startLine + section.split("\n").length - 1,
      linkedFrom: [],
      content: section,
    };
  }

  const range = counterpart.declarationRange;
  if (range === undefined) {
    return null;
  }
  const sliced = sliceSourceRange(content, range);
  return {
    endpoint: counterpart.endpoint,
    kind: "code",
    filePath: counterpart.filePath,
    language: counterpart.language,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    linkedFrom: [],
    content: sliced.content,
  };
}

function compareBlocks(left: ContextBlock, right: ContextBlock): number {
  return compareEndpointOrder(
    { filePath: left.filePath, line: left.startLine, column: 0, endpoint: left.endpoint },
    { filePath: right.filePath, line: right.startLine, column: 0, endpoint: right.endpoint },
  );
}
