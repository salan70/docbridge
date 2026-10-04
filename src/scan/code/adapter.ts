import type { ScannerRuntimes } from "../../config/scanner-runtimes";
import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage } from "../../model/types";
import type { Cancelable } from "../../shared/cancelable";

/** Per-language scan options sourced from the configured code include entry. */
export type CodeScanOptions = {
  visibility?: string[];
};

/** Per-scan context shared by all language adapters. */
export type CodeScanContext = {
  projectRoot: string;
  /** The configuration's `scanners` object, when it sets one. */
  scanners?: ScannerRuntimes;
};

/** One file's path and resolved content, as an adapter receives it. */
export type CodeScanFile = {
  filePath: string;
  content: string;
};

/**
 * The internal extension point for a code language. TypeScript is scanned in
 * process; the other languages are worker-backed and receive every file of a
 * scan in one request through `scanFiles`.
 *
 * @doc docs/specs/scanning.md#code-scanning
 */
export type CodeLanguageAdapter = {
  language: CodeLanguage;
  /**
   * Scan a batch of files of this language in one call. Returns one result per
   * file, in the order of `files`.
   */
  scanFiles(
    files: readonly CodeScanFile[],
    options: CodeScanOptions,
    context: CodeScanContext,
  ): CodeScanResult[];
  /**
   * The cancellable form of `scanFiles` for the Language Server. Adapters that
   * scan in process omit it, and callers fall back to `scanFiles`.
   */
  scanFilesAsync?(
    files: readonly CodeScanFile[],
    options: CodeScanOptions,
    context: CodeScanContext,
  ): Cancelable<CodeScanResult[]>;
  /**
   * Resolve, without blocking, what the adapter runs for one scan of the
   * Language Server: the resolved worker argv and an adapter bound to that
   * resolution, failure included. Cancelling it stops a resolution in
   * progress, such as a runtime probe. Adapters that scan in process omit it
   * and count as argv `[]`.
   */
  prepare?(context: CodeScanContext): Cancelable<PreparedCodeAdapter>;
};

export type PreparedCodeAdapter = {
  argv: readonly string[];
  /** The resolved runtime behind `argv`, when argv alone does not identify it. */
  runtime?: readonly string[];
  adapter: CodeLanguageAdapter;
};
