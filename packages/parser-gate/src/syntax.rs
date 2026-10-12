//! Language-neutral tree-sitter helpers.

use std::ops::Range;

use tree_sitter::{Language, Node, Parser, Tree};

/// How much of a file a syntax error rejects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// The whole file.
    File,
    /// The smallest supported declaration that contains the error, and the
    /// whole file when none does.
    Declaration,
}

/// A supported declaration that contains syntax errors and no smaller
/// supported declaration does.
pub struct Region {
    pub span: Range<usize>,
    /// Where the first error in the region starts, and the kind of its node.
    pub error_start: usize,
    pub error_kind: &'static str,
}

/// Parse `source` with `language`. Returns `None` if the grammar cannot be
/// loaded or the parser gives up.
pub fn parse(language: &Language, source: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(language).ok()?;
    parser.parse(source, None)
}

/// The first node in document order that marks a syntax error: an `ERROR`
/// node, a `MISSING` node, or a leaf that only carries the error flag.
pub fn first_error(tree: &Tree) -> Option<Node<'_>> {
    let root = tree.root_node();
    if !root.has_error() {
        return None;
    }
    // The walk keeps no call stack per level, so input nested arbitrarily
    // deep cannot overflow it.
    let mut cursor = root.walk();
    // A grammar can mark a missing name with a zero-width token that carries
    // the error flag without being `ERROR` or `MISSING`.
    let mut flagged_leaf = None;
    loop {
        let node = cursor.node();
        if node.is_error() || node.is_missing() {
            return Some(flagged_leaf.unwrap_or(node));
        }
        if node.has_error() {
            if cursor.goto_first_child() {
                continue;
            }
            flagged_leaf.get_or_insert(node);
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return Some(flagged_leaf.unwrap_or(root));
            }
        }
    }
}

/// Every node `first_error` would report, in document order.
pub fn all_errors(tree: &Tree) -> Vec<Node<'_>> {
    let root = tree.root_node();
    let mut errors = Vec::new();
    if !root.has_error() {
        return errors;
    }
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.is_error() || node.is_missing() {
            errors.push(node);
        } else if node.has_error() {
            if cursor.goto_first_child() {
                continue;
            }
            errors.push(node);
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                if errors.is_empty() {
                    errors.push(root);
                }
                return errors;
            }
        }
    }
}

/// The kind of the innermost named node, other than an `ERROR` or `MISSING`
/// one, that encloses the first syntax error; the root's kind when there is
/// none. `None` when the tree has no error.
pub fn construct(tree: &Tree) -> Option<&'static str> {
    let error = first_error(tree)?;
    let mut node = error;
    while let Some(parent) = node.parent() {
        if parent.is_named() && !parent.is_error() && !parent.is_missing() {
            return Some(parent.kind());
        }
        node = parent;
    }
    Some(tree.root_node().kind())
}

/// The supported declarations in `spans` that hold an error and no smaller
/// one does. `None` when an error lies outside every span.
pub fn error_regions(errors: &[Node], spans: &[Range<usize>]) -> Option<Vec<Region>> {
    let mut regions: Vec<Region> = Vec::new();
    for error in errors {
        let (start, end) = (error.start_byte(), error.end_byte());
        let span = spans
            .iter()
            .filter(|span| span.start <= start && end <= span.end)
            .min_by_key(|span| span.end - span.start)?;
        if regions.iter().all(|region| region.span != *span) {
            regions.push(Region {
                span: span.clone(),
                error_start: start,
                error_kind: error.kind(),
            });
        }
    }
    Some(regions)
}

/// Whether `span` lies inside one of the regions.
pub fn is_dropped(span: &Range<usize>, regions: &[Region]) -> bool {
    regions
        .iter()
        .any(|region| region.span.start <= span.start && span.end <= region.span.end)
}

#[cfg(test)]
mod tests {
    use super::{all_errors, construct, first_error, parse};

    fn swift() -> tree_sitter::Language {
        tree_sitter_swift::LANGUAGE.into()
    }

    #[test]
    fn a_valid_file_has_no_error() {
        let tree = parse(&swift(), "struct A {}\n").expect("the grammar loads");
        assert!(first_error(&tree).is_none());
    }

    #[test]
    fn the_first_error_in_document_order_is_reported() {
        let source = "struct A {}\nstruct {\n}\nfunc (\n";
        let tree = parse(&swift(), source).expect("the grammar loads");
        let node = first_error(&tree).expect("the file has a syntax error");
        assert_eq!(node.start_position().row, 1);
    }

    #[test]
    fn an_error_flag_without_an_error_node_is_still_an_error() {
        let dart = tree_sitter_dart::LANGUAGE.into();
        for source in ["class { }\n", "var x = 1 +;\n"] {
            let tree = parse(&dart, source).expect("the grammar loads");
            assert!(tree.root_node().has_error(), "{source:?}");
            assert!(first_error(&tree).is_some(), "{source:?}");
        }
    }

    #[test]
    fn deeply_nested_input_does_not_overflow_the_stack() {
        let depth = 100_000;
        let source = format!(
            "let x = {}1{}\nstruct {{\n",
            "(".repeat(depth),
            ")".repeat(depth)
        );
        let tree = parse(&swift(), &source).expect("the grammar loads");
        assert!(first_error(&tree).is_some());
    }

    #[test]
    fn all_errors_starts_with_the_first_error() {
        let source = "struct A {}\nstruct {\n}\nfunc (\n";
        let tree = parse(&swift(), source).expect("the grammar loads");
        let errors = all_errors(&tree);
        assert!(errors.len() > 1);
        assert_eq!(Some(errors[0]), first_error(&tree));
        let clean = parse(&swift(), "struct A {}\n").expect("the grammar loads");
        assert!(all_errors(&clean).is_empty());
    }

    #[test]
    fn the_construct_is_the_named_node_around_the_first_error() {
        let clean = parse(&swift(), "struct A {}\n").expect("the grammar loads");
        assert_eq!(construct(&clean), None);
        let tree = parse(&swift(), "func f() {\n  let x = (\n}\n").expect("the grammar loads");
        let kind = construct(&tree).expect("the file has a syntax error");
        assert_ne!(kind, "ERROR");
        assert!(!kind.is_empty());
    }
}
