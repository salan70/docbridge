export type LinkTarget = {
  filePath: string;
  fragment: string;
};

/**
 * Fixed lowercase identifiers for the code languages SpecLink understands. The
 * set is closed; configuration rejects any other value.
 */
export type CodeLanguage = "typescript" | "swift" | "dart";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "config_file_invalid"
  | "config_unknown_key"
  | "config_invalid_value"
  | "invalid_link_target"
  | "doc_file_not_found"
  | "doc_anchor_not_found"
  | "code_file_not_found"
  | "code_backlink_not_found"
  | "doc_backlink_not_found"
  | "duplicate_doc_anchor"
  | "duplicate_code_symbol"
  | "code_parse_error"
  | "file_read_error"
  | "duplicate_link"
  | "dangling_code_annotation"
  | "unsupported_declaration"
  | "undocumented_symbol";

export type SourceLocation = {
  filePath: string;
  line: number;
  column: number;
};

/** A 1-based line/column position within a file, matching SourceLocation. */
export type Position = {
  line: number;
  column: number;
};

/**
 * A 1-based, end-exclusive text range within a single file. `end` points one
 * column past the last covered character, mirroring the LSP range model.
 */
export type Range = {
  start: Position;
  end: Position;
};

export type SpecLinkDiagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  target: string;
  /**
   * The code language this diagnostic pertains to, when it is known from code
   * scanning or a known code endpoint. Left unset for config diagnostics,
   * Markdown diagnostics, and diagnostics whose target maps to no single
   * configured language.
   */
  language?: CodeLanguage;
  source?: string;
  message: string;
  location?: SourceLocation;
  /**
   * Optional precise range for editor surfaces (LSP). `speclink check` ignores
   * it. Set to the annotation target range for link-target diagnostics or the
   * element range for declaration/heading diagnostics when available.
   */
  range?: Range;
};

export type Summary = {
  errors: number;
  warnings: number;
};

export type CheckResult = {
  diagnostics: SpecLinkDiagnostic[];
  summary: Summary;
};

export type EndpointKind = "code" | "doc";

export type CodeSymbolEndpoint = {
  kind: "code";
  language: CodeLanguage;
  filePath: string;
  /** Human-facing declaration name. */
  symbolName: string;
  /**
   * Language-adapter-produced stable symbol identity used as the `#fragment` of
   * the endpoint. For TypeScript top-level declarations this equals
   * `symbolName`; languages with member endpoints qualify it (e.g.
   * `AuthService.login(email:password:)`).
   */
  canonicalId: string;
  endpoint: string;
  location: SourceLocation;
  /** Range of the declaration name identifier, used as a navigation trigger. */
  nameRange?: Range;
  /**
   * Range of the whole declaration including its leading JSDoc block, used to
   * extract the declaration source as context content.
   */
  declarationRange?: Range;
  /**
   * Range of the declaration's public surface including its leading JSDoc
   * block, but excluding implementation bodies when the syntax has one.
   */
  signatureRange?: Range;
};

export type DocAnchorEndpoint = {
  kind: "doc";
  filePath: string;
  anchor: string;
  endpoint: string;
  headingText: string;
  location: SourceLocation;
  /** Range of the heading text (excluding `#` and surrounding whitespace). */
  headingTextRange?: Range;
};

export type LinkAnnotationDirection = "code-to-doc" | "doc-to-code";

export type LinkAnnotation = {
  direction: LinkAnnotationDirection;
  source: string;
  target: string;
  location: SourceLocation;
  /** Range of the annotation target string (the `file#fragment` text). */
  targetRange?: Range;
};

export type DocLinkAnnotation = LinkAnnotation & {
  direction: "code-to-doc";
};

export type CodeLinkAnnotation = LinkAnnotation & {
  direction: "doc-to-code";
};
