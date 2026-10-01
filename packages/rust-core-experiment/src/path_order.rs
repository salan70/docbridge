//! Port of `src/shared/path-order.ts`.

use std::cmp::Ordering;

/// Compare project-relative paths the way TypeScript's `<` and `>` do on
/// strings: by UTF-16 code unit, which differs from UTF-8 byte order for
/// characters outside the Basic Multilingual Plane.
pub fn compare_paths(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_paths_by_utf16_code_units() {
        let cases = [
            ("a", "b", Ordering::Less),
            ("b", "a", Ordering::Greater),
            ("a", "a", Ordering::Equal),
            ("docs/README.md", "docs/a.md", Ordering::Less),
            ("src/a.ts", "src/a/deep.ts", Ordering::Less),
            ("", "a", Ordering::Less),
            // U+10000 is a surrogate pair (D800 DC00) in UTF-16 and sorts
            // before U+E000, while its UTF-8 bytes (F0 ...) would sort after.
            ("src/\u{10000}.ts", "src/\u{E000}.ts", Ordering::Less),
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
