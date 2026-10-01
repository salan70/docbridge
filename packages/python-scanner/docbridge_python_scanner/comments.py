"""Annotation sources: leading ``#`` comment blocks and docstrings.

Both sources are read from the original source text through ``tokenize``
positions and ``ast`` node offsets, never from ``ast.get_docstring()``, so
every ``@doc`` target keeps the position it has in the file.
"""

from __future__ import annotations

import ast
import bisect
import io
import re
import tokenize
from dataclasses import dataclass

from .links import DocTarget, find_doc_matches
from .positions import LineTable

STRING_PREFIX_PATTERN = re.compile(r"[a-zA-Z]*")
QUOTES = ('"""', "'''", '"', "'")


@dataclass(frozen=True)
class CommentLine:
    """A comment that is the only content of its line."""

    row: int
    col: int
    text: str


class TokenIndex:
    """Tokens of one successfully parsed file, addressable by position."""

    def __init__(self, tokens: list[tokenize.TokenInfo]) -> None:
        self.tokens = tokens
        self._starts = [token.start for token in tokens]
        self.own_line_comments: dict[int, CommentLine] = {}
        for index, token in enumerate(tokens):
            if token.type != tokenize.COMMENT:
                continue
            follower = tokens[index + 1] if index + 1 < len(tokens) else None
            if follower is not None and follower.type == tokenize.NL:
                row, col = token.start
                self.own_line_comments[row] = CommentLine(row, col, token.string[1:])

    @classmethod
    def from_text(cls, parse_text: str) -> TokenIndex:
        return cls(list(tokenize.generate_tokens(io.StringIO(parse_text).readline)))

    def index_at(self, row: int, col: int) -> int:
        """Return the index of the first token starting at or after ``(row, col)``."""
        return bisect.bisect_left(self._starts, (row, col))

    def token_at(self, row: int, col: int) -> tokenize.TokenInfo | None:
        index = self.index_at(row, col)
        if index < len(self.tokens) and self.tokens[index].start == (row, col):
            return self.tokens[index]
        return None

    def leading_comment_block(self, row_above: int, col: int) -> list[CommentLine]:
        """Return the contiguous comment-only lines ending at ``row_above``.

        Every line of the block starts its comment at ``col``; a blank line, a
        code line, or a comment at another column ends the block.
        """
        block: list[CommentLine] = []
        row = row_above
        while row >= 1:
            comment = self.own_line_comments.get(row)
            if comment is None or comment.col != col:
                break
            block.append(comment)
            row -= 1
        block.reverse()
        return block


def comment_block_targets(block: list[CommentLine], table: LineTable) -> list[DocTarget]:
    """Find ``@doc`` targets in each comment line's text after ``#``."""
    targets: list[DocTarget] = []
    for comment in block:
        body_col = comment.col + 1
        for match in find_doc_matches(comment.text):
            targets.append(
                DocTarget(
                    target=match.target,
                    start=table.position_from_chars(comment.row, body_col + match.start),
                    end=table.position_from_chars(comment.row, body_col + match.end),
                )
            )
    return targets


def docstring_node(body: list[ast.stmt]) -> ast.Expr | None:
    """Return the docstring statement of a body, when its first statement is one."""
    if not body:
        return None
    first = body[0]
    if (
        isinstance(first, ast.Expr)
        and isinstance(first.value, ast.Constant)
        and isinstance(first.value.value, str)
    ):
        return first
    return None


def _source_text(table: LineTable, start: tuple[int, int], end: tuple[int, int]) -> str:
    """Return the parse text between two (row, code point col) positions."""
    start_row, start_col = start
    end_row, end_col = end
    if start_row == end_row:
        return table.line_text(start_row)[start_col:end_col]
    pieces = [table.line_text(start_row)[start_col:]]
    pieces.extend(table.line_text(row) for row in range(start_row + 1, end_row))
    pieces.append(table.line_text(end_row)[:end_col])
    return "\n".join(pieces)


def _string_body_span(text: str) -> tuple[int, int]:
    """Return the offsets of a string literal's content, excluding its delimiters."""
    prefix_match = STRING_PREFIX_PATTERN.match(text)
    prefix_length = prefix_match.end() if prefix_match else 0
    rest = text[prefix_length:]
    for quote in QUOTES:
        if rest.startswith(quote) and rest.endswith(quote) and len(rest) >= 2 * len(quote):
            return prefix_length + len(quote), len(text) - len(quote)
    return prefix_length, len(text)


def docstring_targets(node: ast.Expr, table: LineTable, tokens: TokenIndex) -> list[DocTarget]:
    """Find ``@doc`` targets in each literal of a docstring, delimiters excluded.

    A docstring may be parenthesized or implicitly concatenated, so its span
    holds several ``STRING`` tokens between brackets and comments. Each
    literal's body, without its prefix and quotes, is searched on its own, so
    a target never absorbs a closing quote or bracket or continues into the
    next literal. A ``str`` constant never contains an f-string, so every
    literal is a plain ``STRING`` token.
    """
    start_row = node.lineno
    start_col = table.chars_from_bytes(start_row, node.col_offset)
    end_row = node.end_lineno if node.end_lineno is not None else start_row
    end_col = table.chars_from_bytes(
        end_row, node.end_col_offset if node.end_col_offset is not None else 0
    )
    targets: list[DocTarget] = []
    for token in tokens.tokens[tokens.index_at(start_row, start_col) :]:
        if token.start >= (end_row, end_col):
            break
        if token.type == tokenize.STRING:
            targets.extend(_literal_targets(token, table))
    return targets


def _literal_targets(token: tokenize.TokenInfo, table: LineTable) -> list[DocTarget]:
    """Find ``@doc`` targets in one string literal's body, at their source positions."""
    start_row, start_col = token.start
    text = _source_text(table, token.start, token.end)
    body_start, body_end = _string_body_span(text)

    targets: list[DocTarget] = []
    for match in find_doc_matches(text[body_start:body_end]):
        offset = body_start + match.start
        line_break = text.rfind("\n", 0, offset)
        row = start_row + text.count("\n", 0, offset)
        col = offset - (line_break + 1) if line_break >= 0 else start_col + offset
        targets.append(
            DocTarget(
                target=match.target,
                start=table.position_from_chars(row, col),
                end=table.position_from_chars(row, col + len(match.target)),
            )
        )
    return targets
