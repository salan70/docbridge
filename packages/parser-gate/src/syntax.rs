//! Language-neutral tree-sitter helpers.

use tree_sitter::{Language, Node, Parser, Tree};

/// Parse `source` with `language`. Returns `None` if the grammar cannot be
/// loaded or the parser gives up.
pub fn parse(language: &Language, source: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(language).ok()?;
    parser.parse(source, None)
}

/// The first `ERROR` or `MISSING` node in document order, if any.
pub fn first_error(tree: &Tree) -> Option<Node<'_>> {
    let root = tree.root_node();
    if !root.has_error() {
        return None;
    }
    // The walk keeps no call stack per level, so input nested arbitrarily
    // deep cannot overflow it.
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.is_error() || node.is_missing() {
            return Some(node);
        }
        if node.has_error() && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{first_error, parse};

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
}
