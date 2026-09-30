//! The JSON model shared with `src/model/types.ts` and `src/model/scan-result.ts`.
//!
//! Field names, optional-field omission, and enum spellings match the
//! TypeScript types exactly: an optional field is absent from the JSON when
//! the TypeScript value is `undefined`, never `null`. Unknown fields are
//! rejected so that a drift in the TypeScript model surfaces as a runner
//! failure instead of silently passing through.

use serde::{Deserialize, Serialize};

/// The closed set of code languages DocBridge understands.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodeLanguage {
    Typescript,
    Swift,
    Dart,
    Rust,
    Go,
}

impl CodeLanguage {
    /// The JSON spelling, which `collectErroredFiles` compares against a
    /// diagnostic target.
    pub fn as_str(self) -> &'static str {
        match self {
            CodeLanguage::Typescript => "typescript",
            CodeLanguage::Swift => "swift",
            CodeLanguage::Dart => "dart",
            CodeLanguage::Rust => "rust",
            CodeLanguage::Go => "go",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    ConfigFileInvalid,
    ConfigUnknownKey,
    ConfigInvalidValue,
    InvalidLinkTarget,
    DocFileNotFound,
    DocAnchorNotFound,
    CodeFileNotFound,
    CodeSymbolNotFound,
    CodeBacklinkNotFound,
    DocBacklinkNotFound,
    DuplicateDocAnchor,
    DuplicateCodeSymbol,
    CodeParseError,
    CodeScannerUnavailable,
    CodeScannerFailed,
    FileReadError,
    DuplicateLink,
    DanglingCodeAnnotation,
    UnsupportedDeclaration,
    UndocumentedSymbol,
    UnlinkedDocSection,
}

impl DiagnosticCode {
    /// The JSON spelling, which the diagnostic sort compares as a string.
    pub fn as_str(self) -> &'static str {
        match self {
            DiagnosticCode::ConfigFileInvalid => "config_file_invalid",
            DiagnosticCode::ConfigUnknownKey => "config_unknown_key",
            DiagnosticCode::ConfigInvalidValue => "config_invalid_value",
            DiagnosticCode::InvalidLinkTarget => "invalid_link_target",
            DiagnosticCode::DocFileNotFound => "doc_file_not_found",
            DiagnosticCode::DocAnchorNotFound => "doc_anchor_not_found",
            DiagnosticCode::CodeFileNotFound => "code_file_not_found",
            DiagnosticCode::CodeSymbolNotFound => "code_symbol_not_found",
            DiagnosticCode::CodeBacklinkNotFound => "code_backlink_not_found",
            DiagnosticCode::DocBacklinkNotFound => "doc_backlink_not_found",
            DiagnosticCode::DuplicateDocAnchor => "duplicate_doc_anchor",
            DiagnosticCode::DuplicateCodeSymbol => "duplicate_code_symbol",
            DiagnosticCode::CodeParseError => "code_parse_error",
            DiagnosticCode::CodeScannerUnavailable => "code_scanner_unavailable",
            DiagnosticCode::CodeScannerFailed => "code_scanner_failed",
            DiagnosticCode::FileReadError => "file_read_error",
            DiagnosticCode::DuplicateLink => "duplicate_link",
            DiagnosticCode::DanglingCodeAnnotation => "dangling_code_annotation",
            DiagnosticCode::UnsupportedDeclaration => "unsupported_declaration",
            DiagnosticCode::UndocumentedSymbol => "undocumented_symbol",
            DiagnosticCode::UnlinkedDocSection => "unlinked_doc_section",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceLocation {
    pub file_path: String,
    pub line: u64,
    pub column: u64,
}

/// A 1-based line/column position within a file.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub line: u64,
    pub column: u64,
}

/// A 1-based, end-exclusive text range within a single file.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// JSON diagnostic emitted by `docbridge check`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocBridgeDiagnostic {
    pub severity: DiagnosticSeverity,
    pub code: DiagnosticCode,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<CodeLanguage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<SourceLocation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
}

/// The literal `"code"` discriminator of a code symbol endpoint.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodeKind {
    Code,
}

/// The literal `"doc"` discriminator of a doc anchor endpoint.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    Doc,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeSymbolEndpoint {
    pub kind: CodeKind,
    pub language: CodeLanguage,
    pub file_path: String,
    pub symbol_name: String,
    pub canonical_id: String,
    pub endpoint: String,
    pub location: SourceLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_member: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_range: Option<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declaration_range: Option<Range>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_range: Option<Range>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocAnchorEndpoint {
    pub kind: DocKind,
    pub file_path: String,
    pub anchor: String,
    pub endpoint: String,
    pub heading_text: String,
    pub location: SourceLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading_text_range: Option<Range>,
}

/// One ATX heading in document order, including empty headings that create
/// no anchor.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocHeadingOutline {
    pub level: u64,
    pub has_code_annotation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<DocAnchorEndpoint>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkAnnotation {
    pub source: String,
    pub target: String,
    pub location: SourceLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_range: Option<Range>,
}

/// Language-neutral result of scanning a single code file.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeScanResult {
    pub language: CodeLanguage,
    pub file_path: String,
    pub symbols: Vec<CodeSymbolEndpoint>,
    pub undocumented_symbols: Vec<CodeSymbolEndpoint>,
    pub links: Vec<LinkAnnotation>,
    pub diagnostics: Vec<DocBridgeDiagnostic>,
}

/// Result of scanning one Markdown file.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkdownScanResult {
    pub file_path: String,
    pub anchors: Vec<DocAnchorEndpoint>,
    pub headings: Vec<DocHeadingOutline>,
    pub links: Vec<LinkAnnotation>,
    pub diagnostics: Vec<DocBridgeDiagnostic>,
}

/// Either endpoint kind, as `counterpartsOf` returns them.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum GraphEndpoint {
    Code(CodeSymbolEndpoint),
    Doc(DocAnchorEndpoint),
}

impl GraphEndpoint {
    pub fn endpoint(&self) -> &str {
        match self {
            GraphEndpoint::Code(symbol) => &symbol.endpoint,
            GraphEndpoint::Doc(anchor) => &anchor.endpoint,
        }
    }

    pub fn location(&self) -> &SourceLocation {
        match self {
            GraphEndpoint::Code(symbol) => &symbol.location,
            GraphEndpoint::Doc(anchor) => &anchor.location,
        }
    }
}
