//! The string order behind JavaScript's `String.prototype.localeCompare()`.
//!
//! `compareDiagnostics` and `compareEndpointOrder` in the TypeScript core sort
//! with `localeCompare`, which is the ICU root collation of the runtime, not
//! byte order. The observable differences for the ASCII text DocBridge sorts
//! are: punctuation orders by its collation weight instead of its code point,
//! digits sort before letters, and case is a tie-breaker (lowercase first)
//! rather than a primary difference, so `a.md` sorts before `README.md`.
//!
//! This module reproduces that order for ASCII input. Characters outside the
//! printable ASCII range fall back to code point order after every ASCII
//! character; see `FINDINGS.md`.

use std::cmp::Ordering;

/// Printable ASCII in ICU root collation order, as observed from Bun's
/// `localeCompare`. Letters appear once per case pair; the pair shares a
/// primary weight and differs only at the tertiary (case) level.
const PRIMARY_ORDER: &str =
    " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";

fn primary_weight(character: char) -> u32 {
    let folded = character.to_ascii_lowercase();
    match PRIMARY_ORDER.find(folded) {
        Some(index) => index as u32,
        // Everything else sorts after printable ASCII in code point order.
        None => 1_000 + character as u32,
    }
}

fn tertiary_weight(character: char) -> u8 {
    u8::from(character.is_ascii_uppercase())
}

/// Compare two strings the way `left.localeCompare(right)` orders them.
pub fn locale_compare(left: &str, right: &str) -> Ordering {
    let primary = left
        .chars()
        .map(primary_weight)
        .cmp(right.chars().map(primary_weight));
    if primary != Ordering::Equal {
        return primary;
    }
    left.chars()
        .map(tertiary_weight)
        .cmp(right.chars().map(tertiary_weight))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The order Bun's `localeCompare` produced for these inputs.
    const OBSERVED_ORDER: &[&str] = &[
        "1",
        "10",
        "2",
        "a",
        "A",
        "a b",
        "a_b",
        "a_bc",
        "a-",
        "a-b",
        "a-b-c",
        "a.b",
        "a.md",
        "a/b",
        "a1",
        "ab",
        "aB",
        "Ab",
        "ab_c",
        "Ab-",
        "ab-c",
        "abc",
        "b",
        "B",
        "README.md",
        "zz",
    ];

    #[test]
    fn matches_the_observed_locale_compare_order() {
        let mut shuffled: Vec<&str> = OBSERVED_ORDER.iter().rev().copied().collect();
        shuffled.sort_by(|left, right| locale_compare(left, right));
        assert_eq!(shuffled, OBSERVED_ORDER);
    }

    #[test]
    fn orders_every_adjacent_observed_pair() {
        for pair in OBSERVED_ORDER.windows(2) {
            assert_eq!(
                locale_compare(pair[0], pair[1]),
                Ordering::Less,
                "{:?} should sort before {:?}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn equal_strings_are_equal() {
        for text in ["", "a", "src/a.ts#login", "docs/README.md"] {
            assert_eq!(locale_compare(text, text), Ordering::Equal);
        }
    }

    #[test]
    fn case_only_differs_at_the_tertiary_level() {
        let cases = [
            ("docs/a.md", "docs/README.md", Ordering::Less),
            ("docs/README.md", "docs/z.md", Ordering::Less),
            ("Sources/A.swift", "docs/a.md", Ordering::Greater),
            ("swift", "Sources/A.swift", Ordering::Greater),
            ("src/a.ts", "src/a/deep.ts", Ordering::Less),
            ("src/a/deep.ts", "src/b.ts", Ordering::Less),
        ];
        for (left, right, expected) in cases {
            assert_eq!(
                locale_compare(left, right),
                expected,
                "{left:?} vs {right:?}"
            );
        }
    }
}
