import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage } from "../../model/types";

/** Per-language scan options sourced from the configured code include entry. */
export type CodeScanOptions = {
  visibility?: string[];
};

/** Per-scan context shared by all language adapters. */
type CodeScanContext = {
  projectRoot: string;
};

/**
 * The internal extension point for a code language. Slice 1 ships only the
 * in-process TypeScript adapter; Swift, Dart, and Rust adapters arrive as worker-backed
 * implementations in later slices.
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
};
