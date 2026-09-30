import type { CodeFileRead, CodeInclude, CollectedCodeFile } from "../../config/code-language";
import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage, DocBridgeDiagnostic } from "../../model/types";
import type { CodeLanguageAdapter, CodeScanOptions } from "./adapter";
import { typeScriptAdapter } from "./typescript";
import {
  resolveScannerWorkerCommand,
  type ScannerWorkerCommandResolution,
} from "./worker/scanner-executable";
import { invokeScannerWorker, type ScannerWorkerRun } from "./worker/scanner-worker";

/**
 * Replacement adapters for one scan, keyed by language. Languages left out use
 * the built-in adapter.
 */
export type CodeAdapterOverrides = Partial<Record<CodeLanguage, CodeLanguageAdapter>>;

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

type ScanCodeFilesOptions = {
  /** Receives the resolved content for callers that cache it. */
  onContent?: (relPath: string, content: string) => void;
  adapters?: CodeAdapterOverrides;
};

/**
 * Read and scan each collected code file through its language adapter. The
 * `read` callback lets callers source content from disk or from editor buffer
 * overlays. Each language is dispatched to its built-in in-process or
 * worker-backed adapter unless `adapters` replaces it.
 */
export function scanCodeFiles(
  projectRoot: string,
  files: CollectedCodeFile[],
  codeInclude: CodeInclude,
  read: (relPath: string) => CodeFileRead,
  options: ScanCodeFilesOptions = {},
): ScanCodeFilesResult {
  const codeFiles: CodeScanResult[] = [];
  const diagnostics: DocBridgeDiagnostic[] = [];
  for (const { language, relPath } of files) {
    const result = read(relPath);
    if (!result.ok) {
      diagnostics.push(result.diagnostic);
      continue;
    }
    options.onContent?.(relPath, result.content);
    const adapter = options.adapters?.[language] ?? builtInAdapters[language];
    const entry = codeInclude[language];
    const scanOptions: CodeScanOptions =
      entry?.visibility !== undefined ? { visibility: entry.visibility } : {};
    const scan = adapter.scanFile(relPath, result.content, scanOptions, {
      projectRoot,
    });
    diagnostics.push(...scan.diagnostics);
    codeFiles.push(scan);
  }
  return { codeFiles, diagnostics };
}

/**
 * The adapter bound to each supported language. Importing this module is what
 * makes concrete parsers and worker execution available, so callers that only
 * need language metadata import `./code-language` instead.
 */
const builtInAdapters: Readonly<Record<CodeLanguage, CodeLanguageAdapter>> = {
  typescript: typeScriptAdapter,
  swift: createScannerWorkerAdapter("swift", () => resolveScannerWorkerCommand("swift")),
  dart: createScannerWorkerAdapter("dart", () => resolveScannerWorkerCommand("dart")),
  rust: createScannerWorkerAdapter("rust", () => resolveScannerWorkerCommand("rust")),
  go: createScannerWorkerAdapter("go", () => resolveScannerWorkerCommand("go")),
};

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
