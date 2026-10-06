import {
  collectCodeFiles,
  hasExcludedSuffix,
  KNOWN_CODE_LANGUAGES,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "../config/code-language";
import { buildLinkGraph, type LinkGraph } from "../link/graph";
import { resolveLinks } from "../link/resolver";
import { sortDiagnostics } from "../model/diagnostics";
import type { CodeScanResult, MarkdownScanResult } from "../model/scan-result";
import type { DocBridgeDiagnostic } from "../model/types";
import { scanProject } from "../query/project-scan";
import type { CodeAdapterOverrides } from "../scan/code/dispatch";
import { emptyCodeScanCache, type CodeScanCache } from "../scan/code/scan-cache";
import { clearRuntimeProbeCache } from "../scan/code/worker/runtime-worker";
import { abortError, type Cancelable } from "../shared/cancelable";
import { collectFiles, matchGlob, readManagedFile } from "../shared/glob";
import { comparePaths } from "../shared/path-order";
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

type ProjectOptions = {
  /** Replacement code adapters, keyed by language (for tests). */
  adapters?: CodeAdapterOverrides;
};

/** The scan result with its graph and file contents. */
type FullScan = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  diagnostics: DocBridgeDiagnostic[];
  graph: LinkGraph;
  contentByFile: Map<string, string>;
};

/** The project outcome a scan produces, before link resolution. */
type ScanOutcome = { ok: true; scan: FullScan } | { ok: false; diagnostics: DocBridgeDiagnostic[] };

/**
 * Whole-project model for the Language Server. It scans every include-matched
 * file from disk, overlays open-document buffers, and re-resolves the full link
 * graph on demand. Scans reuse the raw code scan results of the
 * last accepted scan for files whose content, configuration, and resolved
 * worker are unchanged.
 *
 * @doc docs/specs/lsp.md#document-model
 */
export class Project {
  private readonly overlay = new Map<string, string>();
  /** Counts overlay changes, so a scan can tell that its snapshot went stale. */
  private overlayRevision = 0;
  private current: ProjectState = emptyState();
  private cache: CodeScanCache = emptyCodeScanCache();

  constructor(
    private readonly projectRoot: string,
    private readonly options: ProjectOptions = {},
  ) {}

  get root(): string {
    return this.projectRoot;
  }

  /** The state of the last accepted scan; empty before the first one. */
  get state(): ProjectState {
    return this.current;
  }

  /**
   * Record (or replace) the buffer overlay for an open document.
   *
   * @doc docs/specs/lsp.md#document-synchronization
   */
  setOverlay(relPath: string, content: string): void {
    this.overlay.set(relPath, content);
    this.overlayRevision += 1;
  }

  /**
   * Drop a buffer overlay; the file reverts to its on-disk version.
   *
   * @doc docs/specs/lsp.md#document-synchronization
   */
  clearOverlay(relPath: string): void {
    this.overlay.delete(relPath);
    this.overlayRevision += 1;
  }

  /**
   * Re-scan and re-resolve the whole project without blocking. The scan reads
   * the overlays and every file before its first worker starts. A changed
   * configuration drops the cached scan results and runtime probes. The
   * scan's state and cache are committed only if it was not cancelled and no
   * overlay changed meanwhile; otherwise the promise rejects with an
   * `AbortError`.
   */
  resolveAsync(): Cancelable<ProjectState> {
    const revision = this.overlayRevision;
    const scan = scanProject({
      ...this.scanSources(new Map(this.overlay)),
      buildGraph: true,
      keepContent: true,
      cache: this.cache,
      // A changed configuration may name another runtime; probe them again.
      onConfigurationChange: clearRuntimeProbeCache,
    });
    let cancelled = false;
    const promise = scan.promise.then((outcome) => {
      if (cancelled || revision !== this.overlayRevision) {
        throw abortError();
      }
      if (outcome.ok) {
        this.cache = outcome.cache;
      }
      this.current = resolvedState(outcome);
      return this.current;
    });
    return {
      promise,
      cancel() {
        cancelled = true;
        scan.cancel();
      },
    };
  }

  /** Where a scan finds files and content: disk plus the given overlays. */
  private scanSources(overlay: ReadonlyMap<string, string>) {
    return {
      projectRoot: this.projectRoot,
      collectCode: (_projectRoot: string, include: CodeInclude) =>
        this.collectCode(include, overlay),
      collectDocs: (_projectRoot: string, patterns: string[]) =>
        this.collectDocs(patterns, overlay),
      readFile: (relPath: string) => this.readContent(relPath, overlay),
      ...(this.options.adapters === undefined ? {} : { adapters: this.options.adapters }),
    };
  }

  /**
   * Collect the managed code files across configured languages, each tagged
   * with its language: disk matches plus any open-buffer path that matches a
   * language's patterns but is not (yet) on disk.
   */
  private collectCode(
    codeInclude: CodeInclude,
    overlay: ReadonlyMap<string, string>,
  ): CollectedCodeFile[] {
    const onDisk = collectCodeFiles(this.projectRoot, codeInclude);
    const seen = new Set(onDisk.map((file) => file.relPath));
    const all = [...onDisk];
    for (const language of KNOWN_CODE_LANGUAGES) {
      const entry = codeInclude[language];
      if (entry === undefined) {
        continue;
      }
      for (const relPath of overlay.keys()) {
        if (seen.has(relPath)) {
          continue;
        }
        if (hasExcludedSuffix(language, relPath)) {
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
  private readContent(relPath: string, overlay: ReadonlyMap<string, string>): CodeFileRead {
    const overlaid = overlay.get(relPath);
    if (overlaid !== undefined) {
      return { ok: true, content: overlaid };
    }
    return readManagedFile(this.projectRoot, relPath);
  }

  /** Collect doc disk matches plus matching open buffers that do not exist on disk. */
  private collectDocs(patterns: string[], overlay: ReadonlyMap<string, string>): string[] {
    const paths = new Set(collectFiles(this.projectRoot, patterns));
    for (const relPath of overlay.keys()) {
      if (paths.has(relPath)) {
        continue;
      }
      if (patterns.some((pattern) => matchGlob(pattern, relPath))) {
        paths.add(relPath);
      }
    }
    return [...paths].toSorted(comparePaths);
  }
}

/** Resolve links over a scan outcome; a failed load yields its diagnostics alone. */
function resolvedState(outcome: ScanOutcome): ProjectState {
  if (!outcome.ok) {
    return { ...emptyState(), diagnostics: sortDiagnostics(outcome.diagnostics) };
  }
  const { codeFiles, docFiles, diagnostics: scanDiagnostics, contentByFile, graph } = outcome.scan;
  const relationship = resolveLinks({ codeFiles, docFiles, scanDiagnostics, audit: false });
  return {
    graph,
    index: buildPositionIndex(graph),
    diagnostics: sortDiagnostics([...scanDiagnostics, ...relationship]),
    contentByFile,
  };
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
