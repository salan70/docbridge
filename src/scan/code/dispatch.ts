import type { CodeFileRead, CodeInclude, CollectedCodeFile } from "../../config/code-language";
import type { ScannerRuntimes } from "../../config/scanner-runtimes";
import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage, DocBridgeDiagnostic } from "../../model/types";
import { cancelableSequence, settledCancelable, type Cancelable } from "../../shared/cancelable";
import type {
  CodeLanguageAdapter,
  CodeScanContext,
  CodeScanFile,
  CodeScanOptions,
  PreparedCodeAdapter,
} from "./adapter";
import { codeScanCacheKey, isReusableScan } from "./scan-cache";
import { javaScriptAdapter, typeScriptAdapter } from "./typescript";
import {
  resolveScannerWorkerCommand,
  type ScannerWorkerCommandResolution,
} from "./worker/scanner-executable";
import {
  invokeScannerWorker,
  invokeScannerWorkerAsync,
  type ScannerWorkerRequest,
  type ScannerWorkerRun,
  type ScannerWorkerRunAsync,
} from "./worker/scanner-worker";

/**
 * Replacement adapters for one scan, keyed by language. Languages left out use
 * the built-in adapter.
 */
export type CodeAdapterOverrides = Partial<Record<CodeLanguage, CodeLanguageAdapter>>;

type ScannerWorkerCommandFactory = (
  context: CodeScanContext,
) => string[] | ScannerWorkerCommandResolution;

type ScannerWorkerAdapterOptions = {
  requestId?: () => string;
  run?: ScannerWorkerRun;
  runAsync?: ScannerWorkerRunAsync;
};

/** A resolved worker command in the one shape every batch call consumes. */
type WorkerCommand =
  | { ok: true; command: string[]; stripEnv: readonly string[]; runtime: readonly string[] }
  | { ok: false; diagnostic: DocBridgeDiagnostic };

/** A worker-backed adapter: every optional member is present. */
type WorkerAdapter = CodeLanguageAdapter &
  Required<Pick<CodeLanguageAdapter, "scanFilesAsync" | "prepare">>;

/**
 * Create the adapter for a worker-backed language. `command` resolves the
 * worker for a scan context; each scan resolves it once, through `prepare` or
 * at the start of a batch, and sends the whole batch in one request.
 */
export function createScannerWorkerAdapter(
  language: CodeLanguage,
  command: ScannerWorkerCommandFactory,
  adapterOptions: ScannerWorkerAdapterOptions = {},
): CodeLanguageAdapter {
  const prepare = (context: CodeScanContext): PreparedCodeAdapter => {
    const resolved = resolveWorkerCommand(command, context);
    return {
      argv: resolved.ok ? resolved.command : [],
      runtime: resolved.ok ? resolved.runtime : [],
      adapter: boundWorkerAdapter(language, resolved, adapterOptions),
    };
  };
  const bound = (context: CodeScanContext): WorkerAdapter =>
    boundWorkerAdapter(language, resolveWorkerCommand(command, context), adapterOptions);
  return {
    language,
    scanFile: (filePath, content, options, context) =>
      bound(context).scanFile(filePath, content, options, context),
    scanFiles: (files, options, context) =>
      files.length === 0 ? [] : bound(context).scanFiles(files, options, context),
    scanFilesAsync: (files, options, context) =>
      files.length === 0
        ? settledCancelable([])
        : bound(context).scanFilesAsync(files, options, context),
    prepare,
  };
}

/** A worker adapter whose command is already resolved, failure included. */
function boundWorkerAdapter(
  language: CodeLanguage,
  resolved: WorkerCommand,
  adapterOptions: ScannerWorkerAdapterOptions,
): WorkerAdapter {
  const adapter: WorkerAdapter = {
    language,
    scanFile(filePath, content, options, context) {
      const [scan] = adapter.scanFiles([{ filePath, content }], options, context);
      return scan ?? emptyScan(language, filePath);
    },
    scanFiles(files, options, context) {
      if (files.length === 0) {
        return [];
      }
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
    },
    scanFilesAsync(files, options, context): Cancelable<CodeScanResult[]> {
      if (files.length === 0) {
        return settledCancelable([]);
      }
      if (!resolved.ok) {
        return settledCancelable(failedBatch(language, files, resolved.diagnostic));
      }
      const task = invokeScannerWorkerAsync(
        workerRequest(language, files, options, context, adapterOptions),
        resolved.command,
        adapterOptions.runAsync,
        resolved.stripEnv,
      );
      return {
        promise: task.promise.then((result) =>
          result.ok ? result.codeFiles : failedBatch(language, files, result.diagnostic),
        ),
        cancel: () => task.cancel(),
      };
    },
    prepare: () => ({
      argv: resolved.ok ? resolved.command : [],
      runtime: resolved.ok ? resolved.runtime : [],
      adapter,
    }),
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
  /** The configuration's `scanners` object, passed to every adapter. */
  scanners?: ScannerRuntimes;
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
  const context = scanContext(projectRoot, options);
  for (const batch of plan.batches) {
    const adapter = options.adapters?.[batch.language] ?? builtInAdapters[batch.language];
    fillBatch(plan, batch, adapter.scanFiles(batch.files, batch.options, context));
  }
  return assemblePlan(plan);
}

function scanContext(projectRoot: string, options: ScanCodeFilesOptions): CodeScanContext {
  return options.scanners === undefined
    ? { projectRoot }
    : { projectRoot, scanners: options.scanners };
}

type ScanCodeFilesAsyncOptions = ScanCodeFilesOptions & {
  /** Reusable results of an earlier scan, keyed by `codeScanCacheKey`. */
  cache?: ReadonlyMap<string, CodeScanResult>;
};

type ScanCodeFilesAsyncResult = ScanCodeFilesResult & {
  /** This scan's reusable results, for the next scan's `cache` once this one is accepted. */
  cache: Map<string, CodeScanResult>;
};

/**
 * The cancellable counterpart of {@link scanCodeFiles} for the Language Server.
 * It reads every file before the first adapter call. A file whose cache key
 * has a reusable result is not scanned again; the remaining files of each
 * language go to its adapter in one call, one language at a time, through
 * `scanFilesAsync` when the adapter has it. Cancelling cancels the running
 * call and rejects with an `AbortError`.
 */
export function scanCodeFilesAsync(
  projectRoot: string,
  files: CollectedCodeFile[],
  codeInclude: CodeInclude,
  read: (relPath: string) => CodeFileRead,
  options: ScanCodeFilesAsyncOptions = {},
): Cancelable<ScanCodeFilesAsyncResult> {
  const plan = planCodeScan(files, codeInclude, read, options.onContent);
  const context = scanContext(projectRoot, options);
  return cancelableSequence(async (step) => {
    const cache = new Map<string, CodeScanResult>();
    for (const batch of plan.batches) {
      const base = options.adapters?.[batch.language] ?? builtInAdapters[batch.language];
      const { argv, runtime, adapter } = base.prepare?.(context) ?? { argv: [], adapter: base };
      const keys = batch.files.map((file) =>
        codeScanCacheKey(batch.language, file.filePath, file.content, batch.options, argv, runtime),
      );
      const cached = keys.map((key) => options.cache?.get(key));
      const missing = batch.files.filter((_, index) => cached[index] === undefined);
      const scanned =
        missing.length === 0
          ? []
          : await step(scanFilesAsync(adapter, missing, batch.options, context));
      let next = 0;
      const results = cached.map((hit) => hit ?? scanned[next++]);
      fillBatch(plan, batch, results);
      results.forEach((scan, index) => {
        const key = keys[index];
        if (scan !== undefined && key !== undefined && isReusableScan(scan)) {
          cache.set(key, scan);
        }
      });
    }
    return { ...assemblePlan(plan), cache };
  });
}

function scanFilesAsync(
  adapter: CodeLanguageAdapter,
  files: readonly CodeScanFile[],
  options: CodeScanOptions,
  context: CodeScanContext,
): Cancelable<CodeScanResult[]> {
  return (
    adapter.scanFilesAsync?.(files, options, context) ??
    settledCancelable(adapter.scanFiles(files, options, context))
  );
}

/**
 * The adapter bound to each supported language. Importing this module is what
 * makes concrete parsers and worker execution available, so callers that only
 * need language metadata import `./code-language` instead.
 */
const builtInAdapters: Readonly<Record<CodeLanguage, CodeLanguageAdapter>> = {
  typescript: typeScriptAdapter,
  javascript: javaScriptAdapter,
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
  results: readonly (CodeScanResult | undefined)[],
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
  const value = command(context);
  if (Array.isArray(value)) {
    return { ok: true, command: value, stripEnv: [], runtime: [] };
  }
  return value.ok
    ? {
        ok: true,
        command: value.command,
        stripEnv: value.stripEnv ?? [],
        runtime: value.runtime ?? [],
      }
    : value;
}
