export type LinkTarget = {
  filePath: string;
  fragment: string;
};

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
  | "typescript_parse_error"
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

export type SpecLinkDiagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  target: string;
  source?: string;
  message: string;
  location?: SourceLocation;
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
  filePath: string;
  symbolName: string;
  endpoint: string;
  location: SourceLocation;
};

export type DocAnchorEndpoint = {
  kind: "doc";
  filePath: string;
  anchor: string;
  endpoint: string;
  headingText: string;
  location: SourceLocation;
};

export type LinkAnnotationDirection = "code-to-doc" | "doc-to-code";

export type LinkAnnotation = {
  direction: LinkAnnotationDirection;
  source: string;
  target: string;
  location: SourceLocation;
};

export type DocLinkAnnotation = LinkAnnotation & {
  direction: "code-to-doc";
};

export type CodeLinkAnnotation = LinkAnnotation & {
  direction: "doc-to-code";
};
