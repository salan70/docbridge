import type {
  CodeLanguage,
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  DocBridgeDiagnostic,
  DocHeadingOutline,
  LinkAnnotation,
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
   * Supported code endpoints with no `@doc` annotation, including type members
   * carrying `isMember`. The core does not report them by default; audit mode
   * turns them into `undocumented_symbol`, skipping the flagged members. A link
   * manifest resolves its `code` target against this set as well as `symbols`.
   */
  undocumentedSymbols: CodeSymbolEndpoint[];
  links: LinkAnnotation[];
  diagnostics: DocBridgeDiagnostic[];
};

/** Result of scanning one Markdown file for anchors, headings, and `@code` links. */
export type MarkdownScanResult = {
  filePath: string;
  anchors: DocAnchorEndpoint[];
  /**
   * Every heading in document order, including empty ones absent from
   * `anchors`. Consumers that need the document's nesting must use this rather
   * than `anchors`, which cannot express a section closed by an empty heading.
   */
  headings: DocHeadingOutline[];
  links: LinkAnnotation[];
  diagnostics: DocBridgeDiagnostic[];
};
