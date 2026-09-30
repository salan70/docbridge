//! Port of `filePathOf` and `compareEndpointOrder` from `src/model/endpoint.ts`.

use std::cmp::Ordering;

use crate::collation::locale_compare;

/// The key `compareEndpointOrder` sorts by.
pub struct EndpointOrderKey<'a> {
    pub file_path: &'a str,
    pub line: u64,
    pub column: u64,
    pub endpoint: &'a str,
}

/// Return the file portion of a canonical `file#fragment` endpoint.
pub fn file_path_of(endpoint: &str) -> &str {
    match endpoint.find('#') {
        Some(index) => &endpoint[..index],
        None => endpoint,
    }
}

/// Compare endpoints by file, source position, then canonical endpoint.
pub fn compare_endpoint_order(left: &EndpointOrderKey, right: &EndpointOrderKey) -> Ordering {
    locale_compare(left.file_path, right.file_path)
        .then(left.line.cmp(&right.line))
        .then(left.column.cmp(&right.column))
        .then_with(|| locale_compare(left.endpoint, right.endpoint))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_path_of_splits_at_the_first_hash() {
        let cases = [
            ("src/a.ts#login", "src/a.ts"),
            ("docs/a.md#a#b", "docs/a.md"),
            ("src/a.ts", "src/a.ts"),
            ("#fragment", ""),
            ("", ""),
        ];
        for (endpoint, expected) in cases {
            assert_eq!(file_path_of(endpoint), expected, "{endpoint:?}");
        }
    }

    fn key<'a>(
        file_path: &'a str,
        line: u64,
        column: u64,
        endpoint: &'a str,
    ) -> EndpointOrderKey<'a> {
        EndpointOrderKey {
            file_path,
            line,
            column,
            endpoint,
        }
    }

    #[test]
    fn orders_by_file_then_position_then_endpoint() {
        let cases = [
            (
                key("src/a.ts", 9, 1, "z"),
                key("src/b.ts", 1, 1, "a"),
                Ordering::Less,
            ),
            (
                key("src/a.ts", 2, 9, "z"),
                key("src/a.ts", 3, 1, "a"),
                Ordering::Less,
            ),
            (
                key("src/a.ts", 2, 5, "z"),
                key("src/a.ts", 2, 17, "a"),
                Ordering::Less,
            ),
            (
                key("src/a.ts", 2, 5, "alpha"),
                key("src/a.ts", 2, 5, "beta"),
                Ordering::Less,
            ),
            (
                key("src/a.ts", 2, 5, "x"),
                key("src/a.ts", 2, 5, "x"),
                Ordering::Equal,
            ),
            (
                key("src/b.ts", 1, 1, "a"),
                key("src/a.ts", 9, 9, "z"),
                Ordering::Greater,
            ),
        ];
        for (left, right, expected) in &cases {
            assert_eq!(compare_endpoint_order(left, right), *expected);
        }
    }
}
