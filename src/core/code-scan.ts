import { codeAdapters } from "./code-adapter-registry";
import type { CodeFileRead, CodeInclude, CollectedCodeFile } from "./code-language";
import type { CodeLanguageAdapter, CodeScanOptions, CodeScanResult } from "./code-scanner";
import {
  resolveScannerWorkerCommand,
  type ScannerWorkerCommandResolution,
} from "./scanner-executable";
import { invokeScannerWorker, type ScannerWorkerRun } from "./scanner-worker";
import type { CodeLanguage, DocBridgeDiagnostic } from "./types";
import { typeScriptAdapter } from "./typescript";

/**
 * Bind every supported language to its adapter. Importing this module is what
 * makes concrete parsers and worker execution available, so callers that only
 * need language metadata import `./code-language` instead.
 */
Object.assign(codeAdapters, {
  typescript: typeScriptAdapter,
  swift: createScannerWorkerAdapter("swift", (_projectRoot) =>
    resolveScannerWorkerCommand("swift"),
  ),
  dart: createScannerWorkerAdapter("dart", (_projectRoot) => resolveScannerWorkerCommand("dart")),
  rust: createScannerWorkerAdapter("rust", (_projectRoot) => resolveScannerWorkerCommand("rust")),
});

/** The registered adapter for a language, or `undefined` when none exists yet. */
export function getCodeAdapter(language: CodeLanguage): CodeLanguageAdapter | undefined {
  return codeAdapters[language];
}

type ScannerWorkerCommandFactory = (
  projectRoot: string,
) => string[] | ScannerWorkerCommandResolution;

type ScannerWorkerAdapterOptions = {
  requestId?: () => string;
  run?: ScannerWorkerRun;
};

export function createScannerWorkerAdapter(
  language: CodeLanguage,
  command: ScannerWorkerCommandFactory,
  adapterOptions: ScannerWorkerAdapterOptions = {},
): CodeLanguageAdapter {
  return {
    language,
    scanFile(filePath, content, options, context) {
      const commandResolution = normalizeScannerCommand(command(context.projectRoot));
      if (!commandResolution.ok) {
        return {
          ...emptyScan(language, filePath),
          diagnostics: [fileScopedScannerDiagnostic(commandResolution.diagnostic, filePath)],
        };
      }
      const result = invokeScannerWorker(
        {
          schemaVersion: 1,
          requestId: adapterOptions.requestId?.() ?? crypto.randomUUID(),
          language,
          projectRoot: context.projectRoot,
          files: [{ filePath, content }],
          options,
        },
        commandResolution.command,
        adapterOptions.run,
      );
      if (result.ok) {
        const scan = result.codeFiles[0];
        return scan ?? emptyScan(language, filePath);
      }
      return {
        ...emptyScan(language, filePath),
        diagnostics: [fileScopedScannerDiagnostic(result.diagnostic, filePath)],
      };
    },
  };
}

type ScanCodeFilesResult = {
  codeFiles: CodeScanResult[];
  diagnostics: DocBridgeDiagnostic[];
};

/**
 * Read and scan each collected code file through its language adapter. The
 * `read` callback lets callers source content from disk or from editor buffer
 * overlays; `onContent` receives the resolved content for callers that cache it.
 * Configured languages are dispatched through the registered in-process or
 * worker-backed adapter.
 */
export function scanCodeFiles(
  projectRoot: string,
  files: CollectedCodeFile[],
  codeInclude: CodeInclude,
  read: (relPath: string) => CodeFileRead,
  onContent?: (relPath: string, content: string) => void,
): ScanCodeFilesResult {
  const codeFiles: CodeScanResult[] = [];
  const diagnostics: DocBridgeDiagnostic[] = [];
  for (const { language, relPath } of files) {
    const result = read(relPath);
    if (!result.ok) {
      diagnostics.push(result.diagnostic);
      continue;
    }
    onContent?.(relPath, result.content);
    const adapter = getCodeAdapter(language);
    if (adapter === undefined) {
      continue;
    }
    const entry = codeInclude[language];
    const options: CodeScanOptions =
      entry?.visibility !== undefined ? { visibility: entry.visibility } : {};
    const scan = adapter.scanFile(relPath, result.content, options, {
      projectRoot,
    });
    diagnostics.push(...scan.diagnostics);
    codeFiles.push(scan);
  }
  return { codeFiles, diagnostics };
}

function emptyScan(language: CodeLanguage, filePath: string): CodeScanResult {
  return {
    language,
    filePath,
    symbols: [],
    undocumentedSymbols: [],
    links: [],
    diagnostics: [],
  };
}

function fileScopedScannerDiagnostic(
  diagnostic: DocBridgeDiagnostic,
  filePath: string,
): DocBridgeDiagnostic {
  return { ...diagnostic, target: filePath };
}

function normalizeScannerCommand(
  value: string[] | ScannerWorkerCommandResolution,
): ScannerWorkerCommandResolution {
  return Array.isArray(value) ? { ok: true, command: value } : value;
}
