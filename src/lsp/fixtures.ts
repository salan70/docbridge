import { buildLinkGraph } from "../link/graph";
import { resolveLinks } from "../link/resolver";
import { sortDiagnostics } from "../model/diagnostics";
import type { CodeScanResult } from "../model/scan-result";
import type { CodeLanguageAdapter } from "../scan/code/adapter";
import { scanTypeScript, typeScriptAdapter } from "../scan/code/typescript";
import { scanMarkdown } from "../scan/markdown/markdown";
import { abortError, deferred } from "../shared/cancelable";
import { buildPositionIndex } from "./index-lookup";
import type { ProjectState } from "./project";

export const CODE_FILE = "src/auth/login.ts";
export const DOC_FILE = "docs/auth.md";

/** Assemble a ProjectState from one code file and one doc file, in memory. */
export function stateOf(code: string, doc: string): ProjectState {
  const codeScan = scanTypeScript(CODE_FILE, code);
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
      [CODE_FILE, code],
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

/**
 * The TypeScript adapter with an asynchronous scan that holds each batch until
 * the test releases it, so a test decides when a scan finishes.
 */
export function heldTypeScript(): { adapter: CodeLanguageAdapter; batches: HeldBatch[] } {
  const batches: HeldBatch[] = [];
  const adapter: CodeLanguageAdapter = {
    ...typeScriptAdapter,
    scanFilesAsync(files, options, context) {
      const settle = deferred<CodeScanResult[]>();
      const batch: HeldBatch = {
        files: files.map((file) => file.filePath),
        release: () => settle.resolve(typeScriptAdapter.scanFiles(files, options, context)),
        cancelled: false,
      };
      batches.push(batch);
      return {
        promise: settle.promise,
        cancel: () => {
          batch.cancelled = true;
          settle.reject(abortError());
        },
      };
    },
  };
  return { adapter, batches };
}
