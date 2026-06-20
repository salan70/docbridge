import { collectCodeFiles, scanCodeFiles } from "./code-language";
import type { CodeScanResult } from "./code-scanner";
import { loadConfig } from "./config";
import { sortDiagnostics } from "./diagnostics";
import { collectFiles, readManagedFile } from "./glob";
import { buildLinkGraph, counterpartsOf, type GraphEndpoint, type LinkGraph } from "./graph";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
import { normalizeChangedPaths } from "./related";
import { resolveLinks } from "./resolver";
import { extractDocSection } from "./section";
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

export type ContextSummary = {
  inputFiles: number;
  contexts: number;
};

export type ContextData = {
  contexts: ContextBlock[];
  summary: ContextSummary;
};

export type ContextResult = ContextData & {
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

  const contexts = [...blockByEndpoint.values()].sort(compareBlocks);
  for (const block of contexts) {
    block.linkedFrom = [...(linkedFromByEndpoint.get(block.endpoint) ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  return {
    contexts,
    summary: { inputFiles: inputSet.size, contexts: contexts.length },
  };
}

export type ContextOptions = {
  projectRoot: string;
  /** Raw input file paths; normalized with `normalizeChangedPaths`. */
  inputFiles: string[];
};

export type ContextOutcome =
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
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const scanDiagnostics: DocBridgeDiagnostic[] = [...configResult.diagnostics];
  const contentByFile = new Map<string, string>();

  const codeScan = scanCodeFiles(
    options.projectRoot,
    collectCodeFiles(options.projectRoot, configResult.config.include.code),
    configResult.config.include.code,
    (relPath) => readManagedFile(options.projectRoot, relPath),
    (relPath, content) => contentByFile.set(relPath, content),
  );
  const codeFiles: CodeScanResult[] = codeScan.codeFiles;
  scanDiagnostics.push(...codeScan.diagnostics);

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectFiles(options.projectRoot, configResult.config.include.docs)) {
    const read = readManagedFile(options.projectRoot, relPath);
    if (!read.ok) {
      scanDiagnostics.push(read.diagnostic);
      continue;
    }
    contentByFile.set(relPath, read.content);
    const scan = scanMarkdown(relPath, read.content);
    scanDiagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  const graph = buildLinkGraph(codeFiles, docFiles);
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
    (diagnostic) =>
      diagnostic.location !== undefined && inputSet.has(diagnostic.location.filePath),
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
  const blocks = result.contexts.map(renderBlock);
  const summary = formatContextSummary(result.summary);
  if (blocks.length === 0) {
    return summary;
  }
  return `${blocks.join("\n\n---\n\n")}\n\n${summary}`;
}

function renderBlock(block: ContextBlock): string {
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
  const fileWord = summary.inputFiles === 1 ? "file" : "files";
  const blockWord = summary.contexts === 1 ? "block" : "blocks";
  return `${summary.inputFiles} input ${fileWord}, ${summary.contexts} context ${blockWord}`;
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
  const startLine = range.start.line;
  // The range end is exclusive; an end at column 1 means the declaration ends
  // exactly at the previous line's newline.
  const endLine = range.end.column === 1 ? range.end.line - 1 : range.end.line;
  const lines = content.split("\n").slice(startLine - 1, endLine);
  const lastIndex = lines.length - 1;
  const lastLine = lines[lastIndex];
  if (lastLine !== undefined && range.end.column > 1) {
    lines[lastIndex] = lastLine.slice(0, range.end.column - 1);
  }
  const firstLine = lines[0];
  if (firstLine !== undefined) {
    lines[0] = firstLine.slice(range.start.column - 1);
  }
  return {
    endpoint: counterpart.endpoint,
    kind: "code",
    filePath: counterpart.filePath,
    language: counterpart.language,
    startLine,
    endLine,
    linkedFrom: [],
    content: lines.join("\n"),
  };
}

function compareBlocks(left: ContextBlock, right: ContextBlock): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.endpoint.localeCompare(right.endpoint)
  );
}
