//! Syntax verdicts for every candidate language: accepted, or the position of
//! the first syntax error. The seven languages beyond Swift and Dart only get a
//! verdict; their symbols are not extracted.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use tree_sitter::{Language as TreeSitterLanguage, ParseOptions, Parser, Tree};

use crate::models::Position;
use crate::position::PositionConverter;
use crate::syntax;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Swift,
    Dart,
    Rust,
    Go,
    Java,
    Python,
    Ruby,
    TypeScript,
    JavaScript,
}

impl Language {
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "swift" => Self::Swift,
            "dart" => Self::Dart,
            "rust" => Self::Rust,
            "go" => Self::Go,
            "java" => Self::Java,
            "python" => Self::Python,
            "ruby" => Self::Ruby,
            "typescript" => Self::TypeScript,
            "javascript" => Self::JavaScript,
            _ => return None,
        })
    }

    /// The tree-sitter grammar, for the languages parsed with one.
    pub fn tree_sitter(self) -> Option<TreeSitterLanguage> {
        match self {
            Self::Swift => Some(tree_sitter_swift::LANGUAGE.into()),
            Self::Dart => Some(tree_sitter_dart::LANGUAGE.into()),
            Self::Go => Some(tree_sitter_go::LANGUAGE.into()),
            Self::Java => Some(tree_sitter_java::LANGUAGE.into()),
            _ => None,
        }
    }
}

/// `None` when `content` parses without syntax errors, otherwise the position
/// of the first error. A parser that recovers and still returns a tree is
/// rejected as soon as it reports one error.
pub fn first_error(language: Language, path: &str, content: &str) -> Option<Position> {
    if let Some(grammar) = language.tree_sitter() {
        return tree_sitter_error(&grammar, content);
    }
    let offset = match language {
        Language::Rust => return rust_error(content),
        Language::Ruby => ruby_error(content),
        Language::TypeScript | Language::JavaScript => oxc_error(language, path, content),
        Language::Python => python_error(content),
        _ => unreachable!("tree-sitter languages return above"),
    }?;
    Some(PositionConverter::new(content).position(offset))
}

fn tree_sitter_error(grammar: &TreeSitterLanguage, content: &str) -> Option<Position> {
    let Some(tree) = syntax::parse(grammar, content) else {
        return Some(PositionConverter::new(content).position(0));
    };
    let node = syntax::first_error(&tree)?;
    Some(PositionConverter::new(content).position(node.start_byte()))
}

fn rust_error(content: &str) -> Option<Position> {
    let error = syn::parse_file(content).err()?;
    let start = error.span().start();
    // `proc-macro2` columns are 0-based counts of characters on a 1-based line.
    let line_text = content.split('\n').nth(start.line.saturating_sub(1));
    let utf16 = line_text.map_or(0, |text| {
        text.chars().take(start.column).map(char::len_utf16).sum()
    });
    Some(Position {
        line: start.line.max(1),
        column: utf16 + 1,
    })
}

fn ruby_error(content: &str) -> Option<usize> {
    let result = ruby_prism::parse(content.as_bytes());
    result
        .errors()
        .map(|diagnostic| diagnostic.location().start_offset())
        .min()
}

fn oxc_error(language: Language, path: &str, content: &str) -> Option<usize> {
    let extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("");
    let allowed: &[&str] = if language == Language::TypeScript {
        &["ts", "tsx", "mts", "cts"]
    } else {
        &["js", "jsx", "mjs", "cjs"]
    };
    let source_type = allowed
        .contains(&extension)
        .then(|| oxc_span::SourceType::from_extension(extension).ok())
        .flatten()
        .unwrap_or(if language == Language::TypeScript {
            oxc_span::SourceType::ts()
        } else {
            oxc_span::SourceType::mjs()
        });
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, content, source_type).parse();
    parsed
        .diagnostics
        .errors()
        .map(|diagnostic| {
            diagnostic
                .labels
                .iter()
                .map(|label| label.offset())
                .min()
                .unwrap_or(0) as usize
        })
        .min()
}

fn python_error(content: &str) -> Option<usize> {
    let error = ruff_python_parser::parse_module(content).err()?;
    Some(error.location.start().to_usize())
}

/// Parse with tree-sitter until `cancel` is set. `None` means the parse was
/// cancelled (or the grammar could not be loaded).
pub fn parse_cancellable(
    grammar: &TreeSitterLanguage,
    content: &str,
    cancel: &AtomicBool,
) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(grammar).ok()?;
    let mut callback = |_: &tree_sitter::ParseState| cancel.load(Ordering::Relaxed);
    let bytes = content.as_bytes();
    parser.parse_with_options(
        &mut |offset, _| &bytes[offset.min(bytes.len())..],
        None,
        Some(ParseOptions::new().progress_callback(&mut callback)),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use super::{first_error, parse_cancellable, Language};

    fn accepted(language: Language, path: &str, content: &str) -> bool {
        first_error(language, path, content).is_none()
    }

    #[test]
    fn each_language_accepts_a_minimal_valid_input() {
        let cases = [
            (Language::Rust, "a.rs", "fn main() {}\n"),
            (Language::Go, "a.go", "package a\n"),
            (Language::Java, "A.java", "class A {}\n"),
            (Language::Python, "a.py", "x = 1\n"),
            (Language::Ruby, "a.rb", "x = 1\n"),
            (Language::TypeScript, "a.ts", "let x: number = 1;\n"),
            (Language::JavaScript, "a.js", "let x = 1;\n"),
        ];
        for (language, path, content) in cases {
            assert!(accepted(language, path, content), "{language:?}");
        }
    }

    #[test]
    fn each_language_rejects_a_minimal_invalid_input() {
        let cases = [
            (Language::Rust, "a.rs", "fn (\n"),
            (Language::Go, "a.go", "package\n"),
            (Language::Java, "A.java", "class {\n"),
            (Language::Python, "a.py", "def (\n"),
            (Language::Ruby, "a.rb", "def (\n"),
            (Language::TypeScript, "a.ts", "let = ;\n"),
            (Language::JavaScript, "a.js", "let = ;\n"),
        ];
        for (language, path, content) in cases {
            let position = first_error(language, path, content);
            assert!(position.is_some(), "{language:?}");
            assert_eq!(position.map(|p| p.line), Some(1), "{language:?}");
        }
    }

    #[test]
    fn a_syntax_error_position_counts_utf16_columns() {
        let position = first_error(Language::Rust, "a.rs", "// 😀\nfn (\n").expect("rejects");
        assert_eq!(position.line, 2);
        let position = first_error(Language::Rust, "a.rs", "/* 😀 */ fn (\n").expect("rejects");
        assert_eq!(position.column, 13);
    }

    #[test]
    fn the_extension_picks_the_typescript_and_javascript_dialect() {
        assert!(accepted(
            Language::TypeScript,
            "a.tsx",
            "let x = <div />;\n"
        ));
        assert!(!accepted(
            Language::TypeScript,
            "a.ts",
            "let x = <div />;\n"
        ));
        assert!(accepted(
            Language::JavaScript,
            "a.jsx",
            "let x = <div />;\n"
        ));
        assert!(!accepted(
            Language::JavaScript,
            "a.js",
            "let x = <div />;\n"
        ));
    }

    #[test]
    fn a_cancelled_parse_returns_no_tree() {
        let grammar = Language::Swift
            .tree_sitter()
            .expect("swift uses tree-sitter");
        let content = "let x = 1\n".repeat(2_000_000);
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        let worker = thread::spawn(move || parse_cancellable(&grammar, &content, &flag));
        thread::sleep(Duration::from_millis(20));
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(worker.join().expect("worker finishes").is_none());
    }
}
