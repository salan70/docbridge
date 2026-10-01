import type { CodeFileRead, CodeInclude, CollectedCodeFile } from "../../config/code-language";
import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage, DocBridgeDiagnostic } from "../../model/types";
import type {
  CodeLanguageAdapter,
  CodeScanContext,
  CodeScanFile,
  CodeScanOptions,
} from "./adapter";
import { typeScriptAdapter } from "./typescript";
import {
  resolveScannerWorkerCommand,
  type ScannerWorkerCommandResolution,
} from "./worker/scanner-executable";
import {
  invokeScannerWorker,
  type ScannerWorkerRequest,
  type ScannerWorkerRun,
} from "./worker/scanner-worker";

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

/** A resolved worker command in the one shape every batch call consumes. */
type WorkerCommand =
  | { ok: true; command: string[]; stripEnv: readonly string[] }
  | { ok: false; diagnostic: DocBridgeDiagnostic };

export function createScannerWorkerAdapter(
  language: CodeLanguage,
  command: ScannerWorkerCommandFactory,
  adapterOptions: ScannerWorkerAdapterOptions = {},
): CodeLanguageAdapter {
  const scanBatch = (
    resolved: WorkerCommand,
    files: readonly CodeScanFile[],
    options: CodeScanOptions,
    context: CodeScanContext,
  ): CodeScanResult[] => {
    if (!resolved.ok) {
      return failedBatch(language, files, resolved.diagnostic);
    }
    const result = invokeScannerWorker(
      workerRequest(language, files, options, context, adapterOptions),
      resolved.command,
      adapterOptions.run,
      resolved.stripEnv,
    );
    return result.ok ? result.codeFiles : failedBatch(language, files, result.diagnostic);
  };

  const adapter: CodeLanguageAdapter = {
    language,
    scanFile(filePath, content, options, context) {
      const [scan] = adapter.scanFiles([{ filePath, content }], options, context);
      return scan ?? emptyScan(language, filePath);
    },
    scanFiles(files, options, context) {
      if (files.length === 0) {
        return [];
      }
      return scanBatch(resolveWorkerCommand(command, context), files, options, context);
    },
  };
  return adapter;
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
 * Read each collected code file, then scan the readable files of each language
 * in one adapter call. The `read` callback lets callers source content from
 * disk or from editor buffer overlays. Each language is dispatched to its
 * built-in in-process or worker-backed adapter unless `adapters` replaces it.
 * Results and diagnostics keep the collection order, with each read failure at
 * its file's position.
 */
export function scanCodeFiles(
  projectRoot: string,
  files: CollectedCodeFile[],
  codeInclude: CodeInclude,
  read: (relPath: string) => CodeFileRead,
  options: ScanCodeFilesOptions = {},
): ScanCodeFilesResult {
  const plan = planCodeScan(files, codeInclude, read, options.onContent);
  for (const batch of plan.batches) {
    const adapter = options.adapters?.[batch.language] ?? builtInAdapters[batch.language];
    fillBatch(plan, batch, adapter.scanFiles(batch.files, batch.options, { projectRoot }));
  }
  return assemblePlan(plan);
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

/** One collected file's place in the output: a read failure or a scan result. */
type CodeScanSlot =
  | { read: false; diagnostic: DocBridgeDiagnostic }
  | { read: true; language: CodeLanguage; relPath: string; scan?: CodeScanResult };

/** The readable files of one language and the slot each of their results fills. */
type LanguageBatch = {
  language: CodeLanguage;
  options: CodeScanOptions;
  files: CodeScanFile[];
  slots: number[];
};

type CodeScanPlan = {
  slots: CodeScanSlot[];
  batches: LanguageBatch[];
};

/** Read every file in collection order and group the readable ones by language. */
function planCodeScan(
  files: CollectedCodeFile[],
  codeInclude: CodeInclude,
  read: (relPath: string) => CodeFileRead,
  onContent: ((relPath: string, content: string) => void) | undefined,
): CodeScanPlan {
  const slots: CodeScanSlot[] = [];
  const batches = new Map<CodeLanguage, LanguageBatch>();
  for (const { language, relPath } of files) {
    const result = read(relPath);
    if (!result.ok) {
      slots.push({ read: false, diagnostic: result.diagnostic });
      continue;
    }
    onContent?.(relPath, result.content);
    let batch = batches.get(language);
    if (batch === undefined) {
      batch = { language, options: scanOptionsFor(codeInclude, language), files: [], slots: [] };
      batches.set(language, batch);
    }
    batch.files.push({ filePath: relPath, content: result.content });
    batch.slots.push(slots.length);
    slots.push({ read: true, language, relPath });
  }
  return { slots, batches: [...batches.values()] };
}

function fillBatch(
  plan: CodeScanPlan,
  batch: LanguageBatch,
  results: readonly CodeScanResult[],
): void {
  batch.slots.forEach((slotIndex, resultIndex) => {
    const slot = plan.slots[slotIndex];
    const scan = results[resultIndex];
    if (slot?.read === true && scan !== undefined) {
      slot.scan = scan;
    }
  });
}

function assemblePlan(plan: CodeScanPlan): ScanCodeFilesResult {
  const codeFiles: CodeScanResult[] = [];
  const diagnostics: DocBridgeDiagnostic[] = [];
  for (const slot of plan.slots) {
    if (!slot.read) {
      diagnostics.push(slot.diagnostic);
      continue;
    }
    const scan = slot.scan ?? emptyScan(slot.language, slot.relPath);
    diagnostics.push(...scan.diagnostics);
    codeFiles.push(scan);
  }
  return { codeFiles, diagnostics };
}

function scanOptionsFor(codeInclude: CodeInclude, language: CodeLanguage): CodeScanOptions {
  const visibility = codeInclude[language]?.visibility;
  return visibility !== undefined ? { visibility } : {};
}

function workerRequest(
  language: CodeLanguage,
  files: readonly CodeScanFile[],
  options: CodeScanOptions,
  context: CodeScanContext,
  adapterOptions: ScannerWorkerAdapterOptions,
): ScannerWorkerRequest {
  return {
    schemaVersion: 1,
    requestId: adapterOptions.requestId?.() ?? crypto.randomUUID(),
    language,
    projectRoot: context.projectRoot,
    files: files.map(({ filePath, content }) => ({ filePath, content })),
    options,
  };
}

/**
 * The result of a request that produced no scan: every file gets an empty
 * result carrying the failure, retargeted at that file so the resolver
 * suppresses what depends on it.
 */
function failedBatch(
  language: CodeLanguage,
  files: readonly CodeScanFile[],
  diagnostic: DocBridgeDiagnostic,
): CodeScanResult[] {
  return files.map(({ filePath }) => ({
    ...emptyScan(language, filePath),
    diagnostics: [{ ...diagnostic, target: filePath }],
  }));
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

function resolveWorkerCommand(
  command: ScannerWorkerCommandFactory,
  context: CodeScanContext,
): WorkerCommand {
  const value = command(context.projectRoot);
  if (Array.isArray(value)) {
    return { ok: true, command: value, stripEnv: [] };
  }
  return value.ok ? { ok: true, command: value.command, stripEnv: [] } : value;
}
