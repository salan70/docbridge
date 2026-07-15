import {
  collectCodeFiles,
  KNOWN_CODE_LANGUAGES,
  scanCodeFiles,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "../core/code-language";
import { loadConfig } from "../core/config";
import { sortDiagnostics } from "../core/diagnostics";
import { collectFiles, matchGlob, readManagedFile } from "../core/glob";
import { buildLinkGraph, type LinkGraph } from "../core/graph";
import { scanMarkdown, type MarkdownScanResult } from "../core/markdown";
import { resolveLinks } from "../core/resolver";
import type { DocBridgeDiagnostic } from "../core/types";
import { buildPositionIndex, type PositionIndex } from "./index-lookup";

/** The resolved whole-project state the LSP handlers query. */
export type ProjectState = {
  graph: LinkGraph;
  index: PositionIndex;
  /** Full, sorted diagnostics across the project. */
  diagnostics: DocBridgeDiagnostic[];
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

    const codeInclude = configResult.config.include.code;
    const docPaths = this.collect(configResult.config.include.docs, false);

    const scanDiagnostics: DocBridgeDiagnostic[] = [...configResult.diagnostics];
    const contentByFile = new Map<string, string>();

    const codeScan = scanCodeFiles(
      this.projectRoot,
      this.collectCode(codeInclude),
      codeInclude,
      (relPath) => this.readContent(relPath),
      (relPath, content) => contentByFile.set(relPath, content),
    );
    const codeFiles = codeScan.codeFiles;
    scanDiagnostics.push(...codeScan.diagnostics);

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
   * Collect the managed code files across configured languages, each tagged
   * with its language: disk matches plus any open-buffer path that matches a
   * language's patterns but is not (yet) on disk.
   */
  private collectCode(codeInclude: CodeInclude): CollectedCodeFile[] {
    const onDisk = collectCodeFiles(this.projectRoot, codeInclude);
    const seen = new Set(onDisk.map((file) => file.relPath));
    const all = [...onDisk];
    for (const language of KNOWN_CODE_LANGUAGES) {
      const entry = codeInclude[language];
      if (entry === undefined) {
        continue;
      }
      for (const relPath of this.overlay.keys()) {
        if (seen.has(relPath)) {
          continue;
        }
        if (language === "typescript" && relPath.endsWith(".d.ts")) {
          continue;
        }
        if (entry.patterns.some((pattern) => matchGlob(pattern, relPath))) {
          seen.add(relPath);
          all.push({ language, relPath });
        }
      }
    }
    return all.toSorted((left, right) => comparePaths(left.relPath, right.relPath));
  }

  /** Resolve content for a code path: buffer overlay first, then on-disk. */
  private readContent(relPath: string): CodeFileRead {
    const overlaid = this.overlay.get(relPath);
    if (overlaid !== undefined) {
      return { ok: true, content: overlaid };
    }
    return readManagedFile(this.projectRoot, relPath);
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
    return [...paths].toSorted(comparePaths);
  }

  /** Resolve content for a path: buffer overlay first, then on-disk. */
  private contentFor(relPath: string, scanDiagnostics: DocBridgeDiagnostic[]): string | undefined {
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

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
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
