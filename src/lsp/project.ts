import { loadConfig } from "../core/config";
import { sortDiagnostics } from "../core/diagnostics";
import { buildLinkGraph, type LinkGraph } from "../core/graph";
import { collectFiles, matchGlob, readManagedFile } from "../core/glob";
import { scanMarkdown, type MarkdownScanResult } from "../core/markdown";
import { resolveLinks } from "../core/resolver";
import { scanTypeScript, type TypeScriptScanResult } from "../core/typescript";
import type { SpecLinkDiagnostic } from "../core/types";
import { buildPositionIndex, type PositionIndex } from "./index-lookup";

/** The resolved whole-project state the LSP handlers query. */
export type ProjectState = {
  graph: LinkGraph;
  index: PositionIndex;
  /** Full, sorted diagnostics across the project. */
  diagnostics: SpecLinkDiagnostic[];
  /** Resolved content (buffer overlay or on-disk) per scanned file path. */
  contentByFile: Map<string, string>;
};

/**
 * Whole-project model for the Language Server. It scans every include-matched
 * file from disk, overlays open-document buffers, and re-resolves the full link
 * graph on demand.
 *
 * @doc docs/specs/lsp.md#document-model
 */
export class Project {
  private readonly overlay = new Map<string, string>();
  private current: ProjectState = emptyState();

  constructor(private readonly projectRoot: string) {}

  get root(): string {
    return this.projectRoot;
  }

  get state(): ProjectState {
    return this.current;
  }

  /** Record (or replace) the buffer overlay for an open document. */
  setOverlay(relPath: string, content: string): void {
    this.overlay.set(relPath, content);
  }

  /** Drop a buffer overlay; the file reverts to its on-disk version. */
  clearOverlay(relPath: string): void {
    this.overlay.delete(relPath);
  }

  /** Re-scan and re-resolve the whole project, returning the new state. */
  resolve(): ProjectState {
    const configResult = loadConfig(this.projectRoot);
    if (!configResult.ok) {
      this.current = {
        ...emptyState(),
        diagnostics: sortDiagnostics(configResult.diagnostics),
      };
      return this.current;
    }

    const codePaths = this.collect(configResult.config.include.code, true);
    const docPaths = this.collect(configResult.config.include.docs, false);

    const scanDiagnostics: SpecLinkDiagnostic[] = [...configResult.diagnostics];
    const contentByFile = new Map<string, string>();

    const codeFiles: TypeScriptScanResult[] = [];
    for (const relPath of codePaths) {
      const content = this.contentFor(relPath, scanDiagnostics);
      if (content === undefined) {
        continue;
      }
      contentByFile.set(relPath, content);
      const scan = scanTypeScript(relPath, content);
      scanDiagnostics.push(...scan.diagnostics);
      codeFiles.push(scan);
    }

    const docFiles: MarkdownScanResult[] = [];
    for (const relPath of docPaths) {
      const content = this.contentFor(relPath, scanDiagnostics);
      if (content === undefined) {
        continue;
      }
      contentByFile.set(relPath, content);
      const scan = scanMarkdown(relPath, content);
      scanDiagnostics.push(...scan.diagnostics);
      docFiles.push(scan);
    }

    const relationship = resolveLinks({
      codeFiles,
      docFiles,
      scanDiagnostics,
      audit: false,
    });

    const graph = buildLinkGraph(codeFiles, docFiles);
    this.current = {
      graph,
      index: buildPositionIndex(graph),
      diagnostics: sortDiagnostics([...scanDiagnostics, ...relationship]),
      contentByFile,
    };
    return this.current;
  }

  /**
   * Collect the set of files for the given include patterns: disk matches plus
   * any open-buffer path that matches but is not (yet) on disk.
   */
  private collect(patterns: string[], isCode: boolean): string[] {
    const paths = new Set(collectFiles(this.projectRoot, patterns));
    for (const relPath of this.overlay.keys()) {
      if (paths.has(relPath)) {
        continue;
      }
      if (isCode && relPath.endsWith(".d.ts")) {
        continue;
      }
      if (patterns.some((pattern) => matchGlob(pattern, relPath))) {
        paths.add(relPath);
      }
    }
    return [...paths].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  /** Resolve content for a path: buffer overlay first, then on-disk. */
  private contentFor(
    relPath: string,
    scanDiagnostics: SpecLinkDiagnostic[],
  ): string | undefined {
    const overlaid = this.overlay.get(relPath);
    if (overlaid !== undefined) {
      return overlaid;
    }
    const read = readManagedFile(this.projectRoot, relPath);
    if (!read.ok) {
      scanDiagnostics.push(read.diagnostic);
      return undefined;
    }
    return read.content;
  }
}

function emptyState(): ProjectState {
  const graph = buildLinkGraph([], []);
  return {
    graph,
    index: buildPositionIndex(graph),
    diagnostics: [],
    contentByFile: new Map(),
  };
}
