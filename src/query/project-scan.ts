import {
  collectCodeFiles,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "../config/code-language";
import { loadConfig, type DocBridgeConfig } from "../config/config";
import { loadLinkManifest } from "../config/link-manifest";
import { buildLinkGraph, type LinkGraph } from "../link/graph";
import { applyLinkManifest } from "../link/manifest-apply";
import type { LinkManifest } from "../model/link-manifest";
import type { CodeScanResult } from "../model/scan-result";
import type { MarkdownScanResult } from "../model/scan-result";
import type { DocBridgeDiagnostic } from "../model/types";
import { scanCodeFilesAsync, type CodeAdapterOverrides } from "../scan/code/dispatch";
import type { CodeScanCache } from "../scan/code/scan-cache";
import { scanMarkdown } from "../scan/markdown/markdown";
import { cancelableSequence, type Cancelable } from "../shared/cancelable";
import { collectFiles, readManagedFile } from "../shared/glob";

type ProjectScan = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  diagnostics: DocBridgeDiagnostic[];
};

type ProjectScanWithGraph = ProjectScan & { graph: LinkGraph };
type ProjectScanWithContent = ProjectScan & { contentByFile: Map<string, string> };

type ScanProjectBaseOptions = {
  projectRoot: string;
  collectCode?: (projectRoot: string, include: CodeInclude) => CollectedCodeFile[];
  collectDocs?: (projectRoot: string, patterns: string[]) => string[];
  readFile?: (relPath: string) => CodeFileRead;
  adapters?: CodeAdapterOverrides;
};

type ScanProjectOptions = ScanProjectBaseOptions & {
  buildGraph?: boolean;
  keepContent?: boolean;
  /** Results of an earlier scan to reuse while the configuration is unchanged. */
  cache?: CodeScanCache;
  /**
   * Called before scanning when the configuration differs from the one
   * `cache` was produced under, so session-wide caches can be dropped too.
   */
  onConfigurationChange?: () => void;
};

type ScanProjectOutcome<Scan extends ProjectScan = ProjectScan> =
  | {
      ok: true;
      scan: Scan;
      /** The cache to pass to the next scan once this one is accepted; empty without `cache`. */
      cache: CodeScanCache;
    }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

export function scanProject(
  options: ScanProjectOptions & { buildGraph: true; keepContent: true },
): Cancelable<ScanProjectOutcome<ProjectScanWithGraph & ProjectScanWithContent>>;
export function scanProject(
  options: ScanProjectOptions & { buildGraph: true; keepContent?: false },
): Cancelable<ScanProjectOutcome<ProjectScanWithGraph>>;
export function scanProject(
  options: ScanProjectOptions & { buildGraph?: false; keepContent: true },
): Cancelable<ScanProjectOutcome<ProjectScanWithContent>>;
export function scanProject(
  options: ScanProjectOptions & { buildGraph?: false; keepContent?: false },
): Cancelable<ScanProjectOutcome<ProjectScan>>;
/**
 * Load configuration, scan every managed file, and optionally retain derived
 * artifacts. The configuration, the manifest, and every managed file are read
 * before the first worker starts. Cancelling cancels the running worker and
 * rejects with an `AbortError`.
 *
 * @doc docs/specs/scanning.md#scanning
 */
export function scanProject(
  options: ScanProjectOptions,
): Cancelable<
  ScanProjectOutcome<ProjectScan & Partial<ProjectScanWithGraph & ProjectScanWithContent>>
> {
  const loaded = loadProjectScan(options, options.keepContent === true);
  if (!loaded.ok) {
    return cancelableSequence(async () => loaded);
  }
  const { inputs } = loaded;
  const previousCache = options.cache;
  const fingerprint = previousCache === undefined ? undefined : JSON.stringify(inputs.config);
  const sameConfiguration =
    previousCache !== undefined && previousCache.fingerprint === fingerprint;
  if (previousCache !== undefined && !sameConfiguration && previousCache.fingerprint !== "") {
    options.onConfigurationChange?.();
  }
  const codeScan = scanCodeFilesAsync(
    options.projectRoot,
    inputs.codeFiles,
    inputs.config.include.code,
    inputs.readFile,
    {
      ...codeScanOptions(inputs, options),
      ...(previousCache === undefined
        ? {}
        : { cache: sameConfiguration ? previousCache.entries : new Map() }),
    },
  );
  const docReads = readDocFiles(inputs, options);
  return cancelableSequence(async (step) => {
    const { cache, ...code } = await step(codeScan);
    const scan = finishProjectScan(inputs, code, docReads, options.buildGraph);
    return {
      ok: true,
      scan: scan as ProjectScanWithGraph & ProjectScanWithContent,
      cache: { fingerprint: fingerprint ?? "", entries: cache },
    };
  });
}

/** Everything a scan reads before scanning code: configuration, manifest, and file list. */
type ProjectScanInputs = {
  config: DocBridgeConfig;
  manifest: LinkManifest;
  diagnostics: DocBridgeDiagnostic[];
  codeFiles: CollectedCodeFile[];
  readFile: (relPath: string) => CodeFileRead;
  contentByFile: Map<string, string> | undefined;
};

function loadProjectScan(
  options: ScanProjectBaseOptions,
  keepContent: boolean,
): { ok: true; inputs: ProjectScanInputs } | { ok: false; diagnostics: DocBridgeDiagnostic[] } {
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const manifestResult = loadLinkManifest(options.projectRoot);
  if (!manifestResult.ok) {
    return { ok: false, diagnostics: [...configResult.diagnostics, ...manifestResult.diagnostics] };
  }

  const collectCode = options.collectCode ?? collectCodeFiles;
  return {
    ok: true,
    inputs: {
      config: configResult.config,
      manifest: manifestResult.manifest,
      diagnostics: [...configResult.diagnostics, ...manifestResult.diagnostics],
      codeFiles: collectCode(options.projectRoot, configResult.config.include.code),
      readFile:
        options.readFile ?? ((relPath: string) => readManagedFile(options.projectRoot, relPath)),
      contentByFile: keepContent ? new Map<string, string>() : undefined,
    },
  };
}

function codeScanOptions(
  inputs: ProjectScanInputs,
  options: ScanProjectBaseOptions,
): Parameters<typeof scanCodeFilesAsync>[4] {
  const { contentByFile } = inputs;
  const { scanners } = inputs.config;
  return {
    ...(contentByFile === undefined
      ? {}
      : { onContent: (relPath, content) => contentByFile.set(relPath, content) }),
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    ...(scanners === undefined ? {} : { scanners }),
  };
}

type DocRead = { relPath: string; read: CodeFileRead };

function readDocFiles(inputs: ProjectScanInputs, options: ScanProjectBaseOptions): DocRead[] {
  const collectDocs = options.collectDocs ?? collectFiles;
  return collectDocs(options.projectRoot, inputs.config.include.docs).map((relPath) => {
    const read = inputs.readFile(relPath);
    if (read.ok) {
      inputs.contentByFile?.set(relPath, read.content);
    }
    return { relPath, read };
  });
}

function finishProjectScan(
  inputs: ProjectScanInputs,
  codeScan: { codeFiles: CodeScanResult[]; diagnostics: DocBridgeDiagnostic[] },
  docReads: DocRead[],
  buildGraph: boolean | undefined,
): ProjectScan & Partial<ProjectScanWithGraph & ProjectScanWithContent> {
  const diagnostics = [...inputs.diagnostics, ...codeScan.diagnostics];

  const docFiles: MarkdownScanResult[] = [];
  for (const { relPath, read } of docReads) {
    if (!read.ok) {
      diagnostics.push(read.diagnostic);
      continue;
    }
    const scan = scanMarkdown(relPath, read.content);
    diagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  // Declared links become ordinary links before anything derived is built, so
  // the resolver, the graph, and every command see one uniform link set.
  const applied = applyLinkManifest({
    manifest: inputs.manifest,
    codeFiles: codeScan.codeFiles,
    docFiles,
    scanDiagnostics: diagnostics,
  });
  diagnostics.push(...applied.diagnostics);

  const codeFiles = applied.codeFiles;
  const scan: ProjectScan & Partial<ProjectScanWithGraph & ProjectScanWithContent> = {
    codeFiles,
    docFiles: applied.docFiles,
    diagnostics,
  };
  if (inputs.contentByFile !== undefined) {
    scan.contentByFile = inputs.contentByFile;
  }
  if (buildGraph === true) {
    scan.graph = buildLinkGraph(codeFiles, applied.docFiles);
  }
  return scan;
}
