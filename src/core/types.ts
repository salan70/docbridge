export type LinkTarget = {
  filePath: string;
  fragment: string;
};

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "doc_file_not_found"
  | "doc_anchor_not_found"
  | "code_file_not_found"
  | "code_symbol_not_found"
  | "duplicate_doc_anchor"
  | "one_way_link"
  | "orphan_doc"
  | "undocumented_symbol";

export type SpecLinkDiagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  target: string;
  source?: string;
  message: string;
};

export type CheckResult = {
  diagnostics: SpecLinkDiagnostic[];
  summary: {
    errors: number;
    warnings: number;
  };
};
