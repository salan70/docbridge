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

/** Scans in process (TypeScript, JavaScript). */
export type InProcessCodeAdapter = {
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
};

/** Runs a worker process; every call is cancellable. */
export type WorkerCodeAdapter = {
  language: CodeLanguage;
  scanFilesAsync(
    files: readonly CodeScanFile[],
    options: CodeScanOptions,
    context: CodeScanContext,
  ): Cancelable<CodeScanResult[]>;
  /**
   * Resolve, without blocking, what the adapter runs for one scan: the
   * resolved worker argv and an adapter bound to that resolution, failure
   * included. Cancelling it stops a resolution in
   * progress, such as a runtime probe.
   */
  prepare(context: CodeScanContext): Cancelable<PreparedCodeAdapter>;
};

/**
 * The internal extension point for a code language. TypeScript is scanned in
 * process; the other languages run in cancellable worker processes.
 *
 * @doc docs/specs/scanning.md#code-scanning
 */
export type CodeLanguageAdapter = InProcessCodeAdapter | WorkerCodeAdapter;

export type PreparedCodeAdapter = {
  argv: readonly string[];
  /** The resolved runtime behind `argv`, when argv alone does not identify it. */
  runtime?: readonly string[];
  adapter: WorkerCodeAdapter;
};
