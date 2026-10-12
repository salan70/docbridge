//! Byte offset to 1-based line and UTF-16 column conversion.
//!
//! DocBridge positions are 1-based lines and 1-based columns counted in UTF-16
//! code units. Only `\n` starts a new line, so the `\r` of a CRLF ending counts
//! as a column on the line it ends. A leading byte order mark is one code unit.

use crate::models::Position;

pub struct PositionConverter<'a> {
    content: &'a str,
    /// Byte offset of the start of each line (0-based).
    line_starts: Vec<usize>,
}

impl<'a> PositionConverter<'a> {
    pub fn new(content: &'a str) -> Self {
        let mut line_starts = vec![0];
        for (index, byte) in content.bytes().enumerate() {
            if byte == b'\n' {
                line_starts.push(index + 1);
            }
        }
        Self {
            content,
            line_starts,
        }
    }

    /// Convert a byte offset into a position. Offsets past the end clamp to the
    /// end of the content, and offsets inside a character round down to its start.
    pub fn position(&self, byte_offset: usize) -> Position {
        let mut offset = byte_offset.min(self.content.len());
        while !self.content.is_char_boundary(offset) {
            offset -= 1;
        }
        let line_index = self.line_starts.partition_point(|&start| start <= offset) - 1;
        let line_start = self.line_starts[line_index];
        let column = self.content[line_start..offset]
            .chars()
            .map(char::len_utf16)
            .sum::<usize>();
        Position {
            line: line_index + 1,
            column: column + 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(content: &str, offset: usize) -> (usize, usize) {
        let position = PositionConverter::new(content).position(offset);
        (position.line, position.column)
    }

    #[test]
    fn ascii_offsets_are_one_based() {
        assert_eq!(at("abc\ndef", 0), (1, 1));
        assert_eq!(at("abc\ndef", 2), (1, 3));
        assert_eq!(at("abc\ndef", 4), (2, 1));
        assert_eq!(at("abc\ndef", 6), (2, 3));
    }

    #[test]
    fn tab_counts_as_one_column() {
        assert_eq!(at("\tab", 2), (1, 3));
    }

    #[test]
    fn crlf_starts_the_next_line_after_the_line_feed() {
        let content = "a\r\nb";
        assert_eq!(at(content, 1), (1, 2));
        assert_eq!(at(content, 3), (2, 1));
    }

    #[test]
    fn leading_bom_is_one_code_unit() {
        assert_eq!(at("\u{FEFF}ab", 3), (1, 2));
        assert_eq!(at("\u{FEFF}ab", 4), (1, 3));
    }

    #[test]
    fn astral_characters_count_as_two_code_units() {
        assert_eq!(at("😀x", 4), (1, 3));
        assert_eq!(at("😀x\ny", 6), (2, 1));
    }

    #[test]
    fn column_after_combining_mark_counts_each_scalar() {
        // "e" + U+0301 combining acute accent (2 bytes), then "x".
        assert_eq!(at("e\u{0301}x", 3), (1, 3));
    }

    #[test]
    fn last_line_without_trailing_newline() {
        assert_eq!(at("a\nbc", 4), (2, 3));
        assert_eq!(at("a\nbc", 100), (2, 3));
    }

    #[test]
    fn empty_content_is_line_one_column_one() {
        assert_eq!(at("", 0), (1, 1));
    }

    #[test]
    fn offset_inside_a_character_rounds_down() {
        assert_eq!(at("😀x", 2), (1, 1));
    }
}
