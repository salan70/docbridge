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
  contentByFile: Map<string, string>;
  graph: LinkGraph;
};

type ScanProjectOptions = {
  projectRoot: string;
  collectCode?: (projectRoot: string, include: CodeInclude) => CollectedCodeFile[];
  collectDocs?: (projectRoot: string, patterns: string[]) => string[];
  readFile?: (relPath: string) => CodeFileRead;
};

type ScanProjectOutcome =
  | { ok: true; scan: ProjectScan }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

/** Load configuration, scan every managed file, and build the shared link graph. */
export function scanProject(options: ScanProjectOptions): ScanProjectOutcome {
  const configResult = loadConfig(options.projectRoot);
  if (!configResult.ok) {
    return { ok: false, diagnostics: configResult.diagnostics };
  }

  const collectCode = options.collectCode ?? collectCodeFiles;
  const collectDocs = options.collectDocs ?? collectFiles;
  const readFile =
    options.readFile ?? ((relPath: string) => readManagedFile(options.projectRoot, relPath));
  const diagnostics: DocBridgeDiagnostic[] = [...configResult.diagnostics];
  const contentByFile = new Map<string, string>();

  const codeScan = scanCodeFiles(
    options.projectRoot,
    collectCode(options.projectRoot, configResult.config.include.code),
    configResult.config.include.code,
    readFile,
    (relPath, content) => contentByFile.set(relPath, content),
  );
  diagnostics.push(...codeScan.diagnostics);

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectDocs(options.projectRoot, configResult.config.include.docs)) {
    const read = readFile(relPath);
    if (!read.ok) {
      diagnostics.push(read.diagnostic);
      continue;
    }
    contentByFile.set(relPath, read.content);
    const scan = scanMarkdown(relPath, read.content);
    diagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  const codeFiles = codeScan.codeFiles;
  return {
    ok: true,
    scan: {
      codeFiles,
      docFiles,
      diagnostics,
      contentByFile,
      graph: buildLinkGraph(codeFiles, docFiles),
    },
  };
}
