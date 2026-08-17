import {
  collectCodeFiles,
  scanCodeFiles,
  type CodeFileRead,
  type CodeInclude,
  type CollectedCodeFile,
} from "./code-language";
import type { CodeScanResult } from "./code-scanner";
import { loadConfig } from "./config";
import { collectFiles, readManagedFile } from "./glob";
import { buildLinkGraph, type LinkGraph } from "./graph";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
import type { DocBridgeDiagnostic } from "./types";

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

  const collectCode = options.collectCode ?? collectCodeFiles;
  const collectDocs = options.collectDocs ?? collectFiles;
  const readFile =
    options.readFile ?? ((relPath: string) => readManagedFile(options.projectRoot, relPath));
  const diagnostics: DocBridgeDiagnostic[] = [...configResult.diagnostics];
  const contentByFile = options.keepContent ? new Map<string, string>() : undefined;

  const codeScan = scanCodeFiles(
    options.projectRoot,
    collectCode(options.projectRoot, configResult.config.include.code),
    configResult.config.include.code,
    readFile,
    contentByFile === undefined
      ? undefined
      : (relPath, content) => contentByFile.set(relPath, content),
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

  const codeFiles = codeScan.codeFiles;
  const scan: ProjectScan & Partial<ProjectScanWithGraph & ProjectScanWithContent> = {
    codeFiles,
    docFiles,
    diagnostics,
  };
  if (contentByFile !== undefined) {
    scan.contentByFile = contentByFile;
  }
  if (options.buildGraph === true) {
    scan.graph = buildLinkGraph(codeFiles, docFiles);
  }
  return {
    ok: true,
    scan,
  };
}
