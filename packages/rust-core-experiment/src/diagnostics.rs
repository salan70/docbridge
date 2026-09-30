//! Port of `collectErroredFiles`, `sortDiagnostics`, and `pluralize` from
//! `src/model/diagnostics.ts`.

use std::cmp::Ordering;
use std::collections::HashSet;

use crate::collation::locale_compare;
use crate::types::{DiagnosticCode, DocBridgeDiagnostic};

/// Sort diagnostics deterministically: diagnostics without `location` first,
/// then by `location.filePath`, `location.line`, `location.column`, `code`,
/// and `target`. The sort is stable, so equal keys keep their input order.
pub fn sort_diagnostics(diagnostics: &[DocBridgeDiagnostic]) -> Vec<DocBridgeDiagnostic> {
    let mut sorted = diagnostics.to_vec();
    sorted.sort_by(compare_diagnostics);
    sorted
}

/// Collect the files whose scan result is incomplete because reading,
/// parsing, or the scanner worker failed.
pub fn collect_errored_files(diagnostics: &[DocBridgeDiagnostic]) -> HashSet<String> {
    let mut errored = HashSet::new();
    for diagnostic in diagnostics {
        if diagnostic.code == DiagnosticCode::FileReadError
            || diagnostic.code == DiagnosticCode::CodeParseError
            || is_file_scoped_scanner_diagnostic(diagnostic)
        {
            errored.insert(diagnostic.target.clone());
        }
    }
    errored
}

/// Whether a scanner diagnostic names one file rather than the whole language.
fn is_file_scoped_scanner_diagnostic(diagnostic: &DocBridgeDiagnostic) -> bool {
    let is_scanner_code = matches!(
        diagnostic.code,
        DiagnosticCode::CodeScannerUnavailable | DiagnosticCode::CodeScannerFailed
    );
    match diagnostic.language {
        Some(language) => is_scanner_code && diagnostic.target != language.as_str(),
        None => false,
    }
}

fn compare_diagnostics(left: &DocBridgeDiagnostic, right: &DocBridgeDiagnostic) -> Ordering {
    let by_code_and_target = || {
        locale_compare(left.code.as_str(), right.code.as_str())
            .then_with(|| locale_compare(&left.target, &right.target))
    };
    match (&left.location, &right.location) {
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(left_location), Some(right_location)) => {
            locale_compare(&left_location.file_path, &right_location.file_path)
                .then(left_location.line.cmp(&right_location.line))
                .then(left_location.column.cmp(&right_location.column))
                .then_with(by_code_and_target)
        }
        (None, None) => by_code_and_target(),
    }
}

/// Append `s` to `word` unless `count` is exactly one.
pub fn pluralize(word: &str, count: usize) -> String {
    if count == 1 {
        word.to_string()
    } else {
        format!("{word}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CodeLanguage, DiagnosticSeverity, SourceLocation};

    fn diagnostic(
        code: DiagnosticCode,
        target: &str,
        language: Option<CodeLanguage>,
        location: Option<(&str, u64, u64)>,
    ) -> DocBridgeDiagnostic {
        DocBridgeDiagnostic {
            severity: DiagnosticSeverity::Error,
            code,
            target: target.to_string(),
            language,
            source: None,
            message: String::new(),
            location: location.map(|(file_path, line, column)| SourceLocation {
                file_path: file_path.to_string(),
                line,
                column,
            }),
            range: None,
        }
    }

    #[test]
    fn collects_read_parse_and_file_scoped_scanner_failures() {
        let cases: &[(DocBridgeDiagnostic, &[&str])] = &[
            (
                diagnostic(DiagnosticCode::FileReadError, "src/a.ts", None, None),
                &["src/a.ts"],
            ),
            (
                diagnostic(
                    DiagnosticCode::CodeParseError,
                    "src/b.ts",
                    Some(CodeLanguage::Typescript),
                    Some(("src/b.ts", 1, 1)),
                ),
                &["src/b.ts"],
            ),
            (
                diagnostic(
                    DiagnosticCode::CodeScannerUnavailable,
                    "Sources/A.swift",
                    Some(CodeLanguage::Swift),
                    None,
                ),
                &["Sources/A.swift"],
            ),
            (
                diagnostic(
                    DiagnosticCode::CodeScannerFailed,
                    "internal/a.go",
                    Some(CodeLanguage::Go),
                    None,
                ),
                &["internal/a.go"],
            ),
            // Language-scoped scanner diagnostics name no file.
            (
                diagnostic(
                    DiagnosticCode::CodeScannerUnavailable,
                    "swift",
                    Some(CodeLanguage::Swift),
                    None,
                ),
                &[],
            ),
            // A scanner diagnostic without a language is not file-scoped.
            (
                diagnostic(
                    DiagnosticCode::CodeScannerFailed,
                    "internal/a.go",
                    None,
                    None,
                ),
                &[],
            ),
            (
                diagnostic(DiagnosticCode::DocFileNotFound, "docs/a.md#x", None, None),
                &[],
            ),
        ];
        for (input, expected) in cases {
            let errored = collect_errored_files(std::slice::from_ref(input));
            let expected: HashSet<String> = expected.iter().map(|s| s.to_string()).collect();
            assert_eq!(errored, expected, "{input:?}");
        }
    }

    #[test]
    fn sorts_unlocated_first_then_by_location_code_and_target() {
        let input = vec![
            diagnostic(
                DiagnosticCode::UndocumentedSymbol,
                "src/ok.ts#b",
                None,
                Some(("src/ok.ts", 3, 1)),
            ),
            diagnostic(DiagnosticCode::FileReadError, "src/broken.ts", None, None),
            diagnostic(
                DiagnosticCode::UndocumentedSymbol,
                "src/ok.ts#a",
                None,
                Some(("src/ok.ts", 3, 1)),
            ),
            diagnostic(
                DiagnosticCode::DocAnchorNotFound,
                "docs/a.md#x",
                None,
                Some(("src/ok.ts", 3, 1)),
            ),
            diagnostic(
                DiagnosticCode::FileReadError,
                "docs/unreadable.md",
                None,
                None,
            ),
            diagnostic(
                DiagnosticCode::CodeBacklinkNotFound,
                "src/ok.ts#c",
                None,
                Some(("docs/a.md", 8, 11)),
            ),
            diagnostic(
                DiagnosticCode::DocBacklinkNotFound,
                "docs/a.md#y",
                None,
                Some(("src/ok.ts", 2, 9)),
            ),
        ];
        let sorted = sort_diagnostics(&input);
        let keys: Vec<(&str, &str)> = sorted
            .iter()
            .map(|d| (d.code.as_str(), d.target.as_str()))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("file_read_error", "docs/unreadable.md"),
                ("file_read_error", "src/broken.ts"),
                ("code_backlink_not_found", "src/ok.ts#c"),
                ("doc_backlink_not_found", "docs/a.md#y"),
                ("doc_anchor_not_found", "docs/a.md#x"),
                ("undocumented_symbol", "src/ok.ts#a"),
                ("undocumented_symbol", "src/ok.ts#b"),
            ]
        );
    }

    #[test]
    fn keeps_input_order_for_equal_keys() {
        let first = DocBridgeDiagnostic {
            message: "first".to_string(),
            ..diagnostic(
                DiagnosticCode::DuplicateLink,
                "docs/a.md#a",
                None,
                Some(("src/a.ts", 3, 9)),
            )
        };
        let second = DocBridgeDiagnostic {
            message: "second".to_string(),
            ..first.clone()
        };
        let sorted = sort_diagnostics(&[first, second]);
        let messages: Vec<&str> = sorted.iter().map(|d| d.message.as_str()).collect();
        assert_eq!(messages, vec!["first", "second"]);
    }

    #[test]
    fn pluralizes_every_count_but_one() {
        let cases = [
            (0, "headings"),
            (1, "heading"),
            (2, "headings"),
            (12, "headings"),
        ];
        for (count, expected) in cases {
            assert_eq!(pluralize("heading", count), expected);
        }
    }
}
