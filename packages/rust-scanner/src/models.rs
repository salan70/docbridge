//! Worker protocol models for the DocBridge Rust scanner.
//!
//! JSON shapes mirror the Swift and Dart scanners so the TypeScript core can
//! validate and consume them identically. Optional fields are omitted (not
//! emitted as `null`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRequest {
    pub schema_version: u32,
    pub request_id: String,
    pub language: String,
    pub project_root: String,
    pub files: Vec<WorkerFile>,
    #[serde(default)]
    pub options: WorkerOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerFile {
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerOptions {
    pub visibility: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResponse {
    pub schema_version: u32,
    pub request_id: String,
    pub language: String,
    pub files: Vec<WorkerFileResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerFileResponse {
    pub file_path: String,
    pub symbols: Vec<CodeSymbol>,
    pub undocumented_symbols: Vec<CodeSymbol>,
    pub links: Vec<DocLink>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSymbol {
    pub kind: String,
    pub language: String,
    pub file_path: String,
    pub symbol_name: String,
    pub canonical_id: String,
    pub endpoint: String,
    pub location: SourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name_range: Option<SourceRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declaration_range: Option<SourceRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature_range: Option<SourceRange>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocLink {
    pub source: String,
    pub target: String,
    pub location: SourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_range: Option<SourceRange>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: String,
    pub code: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<SourceLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<SourceRange>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub line: usize,
    pub column: usize,
}
