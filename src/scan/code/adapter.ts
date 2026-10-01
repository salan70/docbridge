import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage } from "../../model/types";

/** Per-language scan options sourced from the configured code include entry. */
export type CodeScanOptions = {
  visibility?: string[];
};

/** Per-scan context shared by all language adapters. */
export type CodeScanContext = {
  projectRoot: string;
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
  scanFile(
    filePath: string,
    content: string,
    options: CodeScanOptions,
    context: CodeScanContext,
  ): CodeScanResult;
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
