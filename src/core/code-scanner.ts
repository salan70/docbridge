import type {
  CodeLanguage,
  CodeSymbolEndpoint,
  DocLinkAnnotation,
  DocBridgeDiagnostic,
} from "./types";

/**
 * Language-neutral result of scanning a single code file. Every code language
 * adapter, in-process (TypeScript) or worker-backed (Swift, Dart), produces this
 * shape so the resolver, graph, context, and LSP stay language-aware but not
 * language-specific.
 *
 * @doc docs/specs/scanning.md#code-scanning
 */
export type CodeScanResult = {
  language: CodeLanguage;
  filePath: string;
  symbols: CodeSymbolEndpoint[];
  /**
   * Supported code endpoints with no `@doc` annotation. The core does not report
   * them by default; audit mode turns them into `undocumented_symbol`.
   */
  undocumentedSymbols: CodeSymbolEndpoint[];
  links: DocLinkAnnotation[];
  diagnostics: DocBridgeDiagnostic[];
};

/** Per-language scan options sourced from the configured code include entry. */
export type CodeScanOptions = {
  visibility?: string[];
};

/** Per-scan context shared by all language adapters. */
export type CodeScanContext = {
  projectRoot: string;
};

/**
 * The internal extension point for a code language. Slice 1 ships only the
 * in-process TypeScript adapter; Swift and Dart adapters arrive as worker-backed
 * implementations in later slices.
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
