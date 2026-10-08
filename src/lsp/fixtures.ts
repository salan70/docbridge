import { buildLinkGraph } from "../link/graph";
import { resolveLinks } from "../link/resolver";
import { sortDiagnostics } from "../model/diagnostics";
import type { CodeScanResult } from "../model/scan-result";
import type {
  CodeLanguageAdapter,
  InProcessCodeAdapter,
  WorkerCodeAdapter,
} from "../scan/code/adapter";
import { scanTypeScript, typeScriptAdapter } from "../scan/code/typescript";
import { scanMarkdown } from "../scan/markdown/markdown";
import { abortError, settledCancelable } from "../shared/cancelable";
import { buildPositionIndex } from "./index-lookup";
import type { ProjectState } from "./project";

export const CODE_FILE = "src/auth/login.ts";
export const DOC_FILE = "docs/auth.md";

/**
 * Assemble a ProjectState from one code file and one doc file, in memory. The
 * code file is `CODE_FILE` scanned as TypeScript unless `codeScan` gives the
 * scan of `code` under its own path.
 */
export function stateOf(
  code: string,
  doc: string,
  codeScan: CodeScanResult = scanTypeScript(CODE_FILE, code),
): ProjectState {
  const docScan = scanMarkdown(DOC_FILE, doc);
  const graph = buildLinkGraph([codeScan], [docScan]);
  const scanDiagnostics = [...codeScan.diagnostics, ...docScan.diagnostics];
  const relationship = resolveLinks({
    codeFiles: [codeScan],
    docFiles: [docScan],
    scanDiagnostics,
    audit: false,
  });
  return {
    graph,
    index: buildPositionIndex(graph),
    diagnostics: sortDiagnostics([...scanDiagnostics, ...relationship]),
    contentByFile: new Map([
      [codeScan.filePath, code],
      [DOC_FILE, doc],
    ]),
  };
}

/** One asynchronous scan batch a test releases, or observes being cancelled. */
export type HeldBatch = {
  files: string[];
  release(): void;
  cancelled: boolean;
};

type BatchWaiter = PromiseWithResolvers<HeldBatch>;

/**
 * The TypeScript adapter with an asynchronous scan that holds each batch until
 * the test releases it, so a test decides when a scan finishes.
 */
export function heldTypeScript(): {
  adapter: CodeLanguageAdapter;
  batches: HeldBatch[];
  waitForBatch(index: number): Promise<HeldBatch>;
} {
  const batches: HeldBatch[] = [];
  const waiters = new Map<number, BatchWaiter>();
  const waitForBatch = (index: number): Promise<HeldBatch> => {
    const existing = batches[index];
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    let waiter = waiters.get(index);
    if (waiter === undefined) {
      waiter = Promise.withResolvers<HeldBatch>();
      waiters.set(index, waiter);
    }
    return waiter.promise;
  };
  const workerRef: { current?: WorkerCodeAdapter } = {};
  const adapter: WorkerCodeAdapter = {
    language: "typescript",
    scanFilesAsync(files, options, context) {
      const settle = Promise.withResolvers<CodeScanResult[]>();
      const batch: HeldBatch = {
        files: files.map((file) => file.filePath),
        release: () =>
          settle.resolve(
            (typeScriptAdapter as InProcessCodeAdapter).scanFiles(files, options, context),
          ),
        cancelled: false,
      };
      batches.push(batch);
      waiters.get(batches.length - 1)?.resolve(batch);
      return {
        promise: settle.promise,
        cancel: () => {
          batch.cancelled = true;
          settle.reject(abortError());
        },
      };
    },
    prepare: () => {
      const workerAdapter = workerRef.current;
      if (workerAdapter === undefined) {
        throw new Error("the TypeScript worker adapter was not initialized");
      }
      return settledCancelable({ argv: [], adapter: workerAdapter });
    },
  };
  workerRef.current = adapter;
  return { adapter, batches, waitForBatch };
}
