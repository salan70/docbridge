import {
  collectCodeFiles,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "../config/code-language";
import { loadConfig } from "../config/config";
import { loadLinkManifest } from "../config/link-manifest";
import { buildLinkGraph, type LinkGraph } from "../link/graph";
import { applyLinkManifest } from "../link/manifest-apply";
import type { CodeScanResult } from "../model/scan-result";
import type { MarkdownScanResult } from "../model/scan-result";
import type { DocBridgeDiagnostic } from "../model/types";
import { scanCodeFiles, type CodeAdapterOverrides } from "../scan/code/dispatch";
import { scanMarkdown } from "../scan/markdown/markdown";
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
};

type ScanProjectOutcome<Scan extends ProjectScan> =
  | { ok: true; scan: Scan }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

export function scanProject(
  options: ScanProjectBaseOptions & { buildGraph: true; keepContent: true },
): ScanProjectOutcome<ProjectScanWithGraph & ProjectScanWithContent>;
export function scanProject(
  options: ScanProjectBaseOptions & { buildGraph: true; keepContent?: false },
): ScanProjectOutcome<ProjectScanWithGraph>;
export function scanProject(
  options: ScanProjectBaseOptions & { buildGraph?: false; keepContent: true },
): ScanProjectOutcome<ProjectScanWithContent>;
export function scanProject(
  options: ScanProjectBaseOptions & { buildGraph?: false; keepContent?: false },
): ScanProjectOutcome<ProjectScan>;
/**
 * Load configuration, scan every managed file, and optionally retain derived artifacts.
 *
 * @doc docs/specs/scanning.md#scanning
 */
export function scanProject(
  options: ScanProjectOptions,
): ScanProjectOutcome<ProjectScan & Partial<ProjectScanWithGraph & ProjectScanWithContent>> {
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const manifestResult = loadLinkManifest(options.projectRoot);
  if (!manifestResult.ok) {
    return { ok: false, diagnostics: [...configResult.diagnostics, ...manifestResult.diagnostics] };
  }

  const collectCode = options.collectCode ?? collectCodeFiles;
  const collectDocs = options.collectDocs ?? collectFiles;
  const readFile =
    options.readFile ?? ((relPath: string) => readManagedFile(options.projectRoot, relPath));
  const diagnostics: DocBridgeDiagnostic[] = [
    ...configResult.diagnostics,
    ...manifestResult.diagnostics,
  ];
  const contentByFile = options.keepContent ? new Map<string, string>() : undefined;

  const codeScan = scanCodeFiles(
    options.projectRoot,
    collectCode(options.projectRoot, configResult.config.include.code),
    configResult.config.include.code,
    readFile,
    {
      ...(contentByFile === undefined
        ? {}
        : { onContent: (relPath, content) => contentByFile.set(relPath, content) }),
      ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    },
  );
  diagnostics.push(...codeScan.diagnostics);

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectDocs(options.projectRoot, configResult.config.include.docs)) {
    const read = readFile(relPath);
    if (!read.ok) {
      diagnostics.push(read.diagnostic);
      continue;
    }
    contentByFile?.set(relPath, read.content);
    const scan = scanMarkdown(relPath, read.content);
    diagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  // Declared links become ordinary links before anything derived is built, so
  // the resolver, the graph, and every command see one uniform link set.
  const applied = applyLinkManifest({
    manifest: manifestResult.manifest,
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
  if (contentByFile !== undefined) {
    scan.contentByFile = contentByFile;
  }
  if (options.buildGraph === true) {
    scan.graph = buildLinkGraph(codeFiles, applied.docFiles);
  }
  return {
    ok: true,
    scan,
  };
}
