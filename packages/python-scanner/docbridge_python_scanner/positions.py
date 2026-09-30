"""Position conversion: three column systems into 1-based UTF-16 columns.

CPython reports columns in three ways that must be kept apart:

- ``ast`` ``col_offset`` / ``end_col_offset`` are 0-based UTF-8 byte offsets
  into the line;
- ``tokenize`` columns are 0-based Unicode code point indexes;
- ``SyntaxError.offset`` is 1-based in code points.

DocBridge positions are 1-based lines and 1-based UTF-16 code unit columns,
with end-exclusive ranges. Lines split on ``\\n`` only, so a CRLF file keeps
its ``\\r`` inside the line, after every token. A UTF-8 BOM is removed before
parsing, because CPython rejects it inside a ``str``, and is counted back in as
the first character of line 1.
"""

from __future__ import annotations

BOM = "﻿"


def utf16_length(text: str) -> int:
    """Return the number of UTF-16 code units needed to encode ``text``."""
    return len(text) + sum(1 for character in text if ord(character) >= 0x10000)


class LineTable:
    """Line-based column conversion for one file's content."""

    def __init__(self, content: str) -> None:
        self.has_bom = content.startswith(BOM)
        self.parse_text = content[len(BOM) :] if self.has_bom else content
        self.lines = self.parse_text.split("\n")

    def line_text(self, line: int) -> str:
        """Return the parse text of a 1-based line, or ``""`` outside the file."""
        if 1 <= line <= len(self.lines):
            return self.lines[line - 1]
        return ""

    def column_from_chars(self, line: int, chars: int) -> int:
        """Convert a 0-based code point index (``tokenize``) into a column."""
        text = self.line_text(line)
        chars = max(0, min(chars, len(text)))
        bom_units = 1 if self.has_bom and line == 1 else 0
        return utf16_length(text[:chars]) + 1 + bom_units

    def column_from_bytes(self, line: int, byte_offset: int) -> int:
        """Convert a 0-based UTF-8 byte offset (``ast``) into a column."""
        encoded = self.line_text(line).encode("utf-8")
        prefix = encoded[: max(0, byte_offset)].decode("utf-8", errors="ignore")
        return self.column_from_chars(line, len(prefix))

    def column_from_offset(self, line: int, offset: int) -> int:
        """Convert a 1-based code point offset (``SyntaxError``) into a column."""
        return self.column_from_chars(line, offset - 1)

    def chars_from_bytes(self, line: int, byte_offset: int) -> int:
        """Convert a 0-based UTF-8 byte offset into a 0-based code point index."""
        encoded = self.line_text(line).encode("utf-8")
        return len(encoded[: max(0, byte_offset)].decode("utf-8", errors="ignore"))

    def position_from_chars(self, line: int, chars: int) -> dict[str, int]:
        return {"line": line, "column": self.column_from_chars(line, chars)}

    def position_from_bytes(self, line: int, byte_offset: int) -> dict[str, int]:
        return {"line": line, "column": self.column_from_bytes(line, byte_offset)}


def make_range(start: dict[str, int], end: dict[str, int]) -> dict[str, dict[str, int]]:
    return {"start": start, "end": end}


def make_location(file_path: str, position: dict[str, int]) -> dict[str, object]:
    return {"filePath": file_path, "line": position["line"], "column": position["column"]}
