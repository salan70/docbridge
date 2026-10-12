//! Dart scanning. Symbol extraction is not implemented yet; only syntax
//! errors are reported.

use crate::models::{Diagnostic, SourceLocation, WorkerFile, WorkerFileResponse};
use crate::position::PositionConverter;
use crate::syntax;

pub fn scan_file(file: &WorkerFile, _visibility: Option<&[String]>) -> WorkerFileResponse {
    let language = tree_sitter_dart::LANGUAGE.into();
    let mut diagnostics = Vec::new();
    if let Some(tree) = syntax::parse(&language, &file.content) {
        if let Some(node) = syntax::first_error(&tree) {
            let position = PositionConverter::new(&file.content).position(node.start_byte());
            diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                code: "code_parse_error".to_string(),
                target: file.file_path.clone(),
                language: Some("dart".to_string()),
                source: None,
                message: format!("Dart parse error: syntax error near {}.", node.kind()),
                location: Some(SourceLocation {
                    file_path: file.file_path.clone(),
                    line: position.line,
                    column: position.column,
                }),
                range: None,
            });
        }
    }
    WorkerFileResponse {
        file_path: file.file_path.clone(),
        symbols: vec![],
        undocumented_symbols: vec![],
        links: vec![],
        diagnostics,
    }
}
