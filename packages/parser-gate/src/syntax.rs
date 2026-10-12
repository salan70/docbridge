//! Language-neutral tree-sitter helpers.

use tree_sitter::{Language, Node, Parser, Tree};

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
}
