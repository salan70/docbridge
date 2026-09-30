//! Port of `src/shared/path-order.ts`.

use std::cmp::Ordering;

/// Compare project-relative paths using their stable bytewise order.
pub fn compare_paths(left: &str, right: &str) -> Ordering {
    left.as_bytes().cmp(right.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_paths_by_their_bytes() {
        let cases = [
            ("a", "b", Ordering::Less),
            ("b", "a", Ordering::Greater),
            ("a", "a", Ordering::Equal),
            ("docs/README.md", "docs/a.md", Ordering::Less),
            ("src/a.ts", "src/a/deep.ts", Ordering::Less),
            ("", "a", Ordering::Less),
        ];
        for (left, right, expected) in cases {
            assert_eq!(
                compare_paths(left, right),
                expected,
                "{left:?} vs {right:?}"
            );
        }
    }
}
