import { join } from "node:path";

import type {
  CodeLanguageAdapter,
  CodeScanOptions,
  CodeScanResult,
} from "./code-scanner";
import { collectFiles } from "./glob";
import {
  invokeScannerWorker,
  type ScannerWorkerRun,
} from "./scanner-worker";
import { typeScriptAdapter } from "./typescript";
import type { CodeLanguage, SpecLinkDiagnostic } from "./types";

/**
 * A configured code language entry. Every entry is an object; shorthand pattern
 * arrays are not accepted.
 *
 * @doc docs/specs/configuration.md#code-languages
 */
export type CodeIncludeEntry = {
  patterns: string[];
  /** Optional language-specific visibility scope; validated per adapter. */
  visibility?: string[];
};

/** The language-keyed `include.code` map. */
export type CodeInclude = Partial<Record<CodeLanguage, CodeIncludeEntry>>;

/** Fixed, ordered set of supported code language IDs. */
export const KNOWN_CODE_LANGUAGES: readonly CodeLanguage[] = [
  "typescript",
  "swift",
  "dart",
];

export function isCodeLanguage(value: string): value is CodeLanguage {
  return (KNOWN_CODE_LANGUAGES as readonly string[]).includes(value);
}

const ADAPTERS: Partial<Record<CodeLanguage, CodeLanguageAdapter>> = {
  typescript: typeScriptAdapter,
  swift: createScannerWorkerAdapter("swift", (projectRoot) => [
    join(projectRoot, "packages/swift-scanner/.build/release/speclink-swift-scanner"),
  ]),
  dart: createScannerWorkerAdapter("dart", (projectRoot) => [
    join(projectRoot, "packages/dart-scanner/bin/speclink_dart_scanner"),
  ]),
};

/** The registered adapter for a language, or `undefined` when none exists yet. */
export function getCodeAdapter(
  language: CodeLanguage,
): CodeLanguageAdapter | undefined {
  return ADAPTERS[language];
}

export type ScannerWorkerCommandFactory = (projectRoot: string) => string[];

export type ScannerWorkerAdapterOptions = {
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
      const result = invokeScannerWorker(
        {
          schemaVersion: 1,
          requestId: adapterOptions.requestId?.() ?? crypto.randomUUID(),
          language,
          projectRoot: context.projectRoot,
          files: [{ filePath, content }],
          options,
        },
        command(context.projectRoot),
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

export function setCodeAdapterForTest(
  language: CodeLanguage,
  adapter: CodeLanguageAdapter,
): () => void {
  const previous = ADAPTERS[language];
  ADAPTERS[language] = adapter;
  return () => {
    if (previous === undefined) {
      delete ADAPTERS[language];
    } else {
      ADAPTERS[language] = previous;
    }
  };
}

export type CollectedCodeFile = {
  language: CodeLanguage;
  relPath: string;
};

/**
 * Collect every managed code file across configured languages, each tagged with
 * its owning language. Results are unique and sorted by path. Files claimed by
 * more than one language are rejected at config load (see {@link codeFileOwners}).
 */
export function collectCodeFiles(
  projectRoot: string,
  codeInclude: CodeInclude,
): CollectedCodeFile[] {
  const collected: CollectedCodeFile[] = [];
  const seen = new Set<string>();
  for (const language of KNOWN_CODE_LANGUAGES) {
    const entry = codeInclude[language];
    if (entry === undefined) {
      continue;
    }
    for (const relPath of collectFiles(projectRoot, entry.patterns)) {
      if (seen.has(relPath)) {
        // Defensive: overlap is rejected at config load, so a repeat here would
        // only occur from concurrent edits. Keep the first owning language.
        continue;
      }
      seen.add(relPath);
      collected.push({ language, relPath });
    }
  }
  collected.sort((left, right) =>
    left.relPath < right.relPath ? -1 : left.relPath > right.relPath ? 1 : 0,
  );
  return collected;
}

export type CodeFileRead =
  | { ok: true; content: string }
  | { ok: false; diagnostic: SpecLinkDiagnostic };

export type ScanCodeFilesResult = {
  codeFiles: CodeScanResult[];
  diagnostics: SpecLinkDiagnostic[];
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
  const diagnostics: SpecLinkDiagnostic[] = [];
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

/**
 * Map each managed code file to the configured languages whose patterns match
 * it. Used by config validation to reject a file claimed by multiple languages.
 */
export function codeFileOwners(
  projectRoot: string,
  codeInclude: CodeInclude,
): Map<string, CodeLanguage[]> {
  const owners = new Map<string, CodeLanguage[]>();
  for (const language of KNOWN_CODE_LANGUAGES) {
    const entry = codeInclude[language];
    if (entry === undefined) {
      continue;
    }
    for (const relPath of collectFiles(projectRoot, entry.patterns)) {
      const existing = owners.get(relPath);
      if (existing === undefined) {
        owners.set(relPath, [language]);
      } else if (!existing.includes(language)) {
        existing.push(language);
      }
    }
  }
  return owners;
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
  diagnostic: SpecLinkDiagnostic,
  filePath: string,
): SpecLinkDiagnostic {
  return { ...diagnostic, target: filePath };
}
