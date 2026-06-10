import { isAbsolute, relative } from "node:path";

import { loadConfig } from "./config";
import { collectFiles, readManagedFile } from "./glob";
import { buildLinkGraph, counterpartsOf, type GraphEndpoint, type LinkGraph } from "./graph";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
import { scanTypeScript, type TypeScriptScanResult } from "./typescript";
import type { SpecLinkDiagnostic } from "./types";

export type RelatedCounterpart = {
  endpoint: string;
  filePath: string;
  inChangeSet: boolean;
};

export type RelatedEndpoint = {
  endpoint: string;
  counterparts: RelatedCounterpart[];
};

export type RelatedFile = {
  filePath: string;
  endpoints: RelatedEndpoint[];
};

export type RelatedSummary = {
  changedFiles: number;
  filesWithLinks: number;
};

export type RelatedResult = {
  files: RelatedFile[];
  summary: RelatedSummary;
};

/**
 * Normalize raw changed-file paths (as emitted by `git diff --name-only` or
 * typed by hand) into the root-relative form used by scan results: absolute
 * paths are relativized against `projectRoot`, leading `./` segments are
 * stripped, empty entries are dropped, and duplicates are deduplicated.
 */
export function normalizeChangedPaths(projectRoot: string, paths: string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      continue;
    }
    const relativized = isAbsolute(trimmed) ? relative(projectRoot, trimmed) : trimmed;
    normalized.add(relativized.replace(/^(\.\/)+/, ""));
  }
  return [...normalized];
}

/**
 * List the counterparts of every linked endpoint in the given changed files.
 * Changed files without counterparts are omitted from `files` but counted in
 * `summary.changedFiles`.
 */
export function computeRelated(graph: LinkGraph, changedFiles: string[]): RelatedResult {
  const changedSet = new Set(changedFiles);

  const sortedPaths = [...changedSet].sort((left, right) => left.localeCompare(right));
  const endpointsByFile = indexEndpointsByFile(graph);

  const files: RelatedFile[] = [];
  for (const filePath of sortedPaths) {
    const endpoints: RelatedEndpoint[] = [];
    for (const endpoint of endpointsByFile.get(filePath) ?? []) {
      const counterparts = counterpartsOf(graph, endpoint.endpoint).map((counterpart) => ({
        endpoint: counterpart.endpoint,
        filePath: counterpart.filePath,
        inChangeSet: changedSet.has(counterpart.filePath),
      }));
      if (counterparts.length > 0) {
        endpoints.push({ endpoint: endpoint.endpoint, counterparts });
      }
    }
    if (endpoints.length > 0) {
      files.push({ filePath, endpoints });
    }
  }

  return {
    files,
    summary: { changedFiles: changedSet.size, filesWithLinks: files.length },
  };
}

export type RelatedGateViolation = {
  changedEndpoint: string;
  changedFilePath: string;
  counterpartEndpoint: string;
  counterpartFilePath: string;
};

/**
 * Collect the gate violations in a `RelatedResult`: every counterpart whose
 * file is not itself in the change set, in result order.
 *
 * @doc docs/specs/cli.md#related-gate-mode
 */
export function collectGateViolations(result: RelatedResult): RelatedGateViolation[] {
  const violations: RelatedGateViolation[] = [];
  for (const file of result.files) {
    for (const endpoint of file.endpoints) {
      for (const counterpart of endpoint.counterparts) {
        if (!counterpart.inChangeSet) {
          violations.push({
            changedEndpoint: endpoint.endpoint,
            changedFilePath: file.filePath,
            counterpartEndpoint: counterpart.endpoint,
            counterpartFilePath: counterpart.filePath,
          });
        }
      }
    }
  }
  return violations;
}

export type RelatedOptions = {
  projectRoot: string;
  /** Raw changed-file paths; normalized with `normalizeChangedPaths`. */
  changedFiles: string[];
};

export type RelatedOutcome =
  | { ok: true; result: RelatedResult }
  | { ok: false; diagnostics: SpecLinkDiagnostic[] };

/**
 * Full orchestration for `speclink related`: load config, scan the managed
 * files, build the link graph, and compute the counterparts of the changed
 * files. Unreadable files are skipped silently; `speclink check` is the
 * surface that reports them.
 *
 * @doc docs/specs/cli.md#related-command
 */
export function related(options: RelatedOptions): RelatedOutcome {
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const codeFiles: TypeScriptScanResult[] = [];
  for (const relPath of collectFiles(options.projectRoot, configResult.config.include.code)) {
    const read = readManagedFile(options.projectRoot, relPath);
    if (read.ok) {
      codeFiles.push(scanTypeScript(relPath, read.content));
    }
  }

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectFiles(options.projectRoot, configResult.config.include.docs)) {
    const read = readManagedFile(options.projectRoot, relPath);
    if (read.ok) {
      docFiles.push(scanMarkdown(relPath, read.content));
    }
  }

  const graph = buildLinkGraph(codeFiles, docFiles);
  const changedFiles = normalizeChangedPaths(options.projectRoot, options.changedFiles);
  return { ok: true, result: computeRelated(graph, changedFiles) };
}

/**
 * Render a `RelatedResult` as the human-readable `speclink related` report:
 * one block per changed file with links, one `fragment -> endpoint (mark)`
 * line per counterpart, then the summary line.
 */
export function formatRelatedResult(result: RelatedResult): string {
  const lines: string[] = [];
  for (const file of result.files) {
    lines.push(file.filePath);
    for (const endpoint of file.endpoints) {
      const fragment = fragmentOf(endpoint.endpoint);
      for (const counterpart of endpoint.counterparts) {
        const mark = counterpart.inChangeSet ? "in change set" : "not in change set";
        lines.push(`  ${fragment} -> ${counterpart.endpoint} (${mark})`);
      }
    }
    lines.push("");
  }
  lines.push(formatRelatedSummary(result.summary));
  return lines.join("\n");
}

/**
 * Render gate violations as the human-readable `speclink related --gate`
 * report: one `changed -> counterpart` line per violation, then the summary.
 */
export function formatGateResult(result: RelatedResult, violations: RelatedGateViolation[]): string {
  const lines: string[] = [];
  for (const violation of violations) {
    lines.push(
      `${violation.changedEndpoint} -> ${violation.counterpartEndpoint} (counterpart not in change set)`,
    );
  }
  if (violations.length > 0) {
    lines.push("");
  }
  lines.push(formatGateSummary(result.summary.changedFiles, violations.length));
  return lines.join("\n");
}

function formatGateSummary(changedFiles: number, violations: number): string {
  const fileWord = changedFiles === 1 ? "file" : "files";
  const counterpartWord = violations === 1 ? "counterpart" : "counterparts";
  return `${changedFiles} changed ${fileWord}, ${violations} ${counterpartWord} not in change set`;
}

function formatRelatedSummary(summary: RelatedSummary): string {
  const fileWord = summary.changedFiles === 1 ? "file" : "files";
  return `${summary.changedFiles} changed ${fileWord}, ${summary.filesWithLinks} with links`;
}

function fragmentOf(endpoint: string): string {
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(hashIndex + 1);
}

/** Index every graph endpoint by file path, each file's list sorted by position. */
function indexEndpointsByFile(graph: LinkGraph): Map<string, GraphEndpoint[]> {
  const byFile = new Map<string, GraphEndpoint[]>();
  const add = (endpoint: GraphEndpoint): void => {
    const existing = byFile.get(endpoint.filePath);
    if (existing === undefined) {
      byFile.set(endpoint.filePath, [endpoint]);
    } else {
      existing.push(endpoint);
    }
  };
  for (const code of graph.codeByEndpoint.values()) {
    add(code);
  }
  for (const doc of graph.docByEndpoint.values()) {
    add(doc);
  }
  for (const endpoints of byFile.values()) {
    endpoints.sort(
      (left, right) =>
        left.location.line - right.location.line || left.location.column - right.location.column,
    );
  }
  return byFile;
}
