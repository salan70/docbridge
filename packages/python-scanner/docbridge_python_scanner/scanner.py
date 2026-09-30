"""Per-file scanning: parse, collect declarations, and build the response file."""

from __future__ import annotations

import ast
import tokenize

from .comments import TokenIndex
from .declarations import DeclarationCollector, DeclarationEntry, Entry, Member, UnsupportedEntry
from .links import INVALID_LINK_TARGET_MESSAGE, DocTarget, is_valid_link_target
from .positions import LineTable, make_location

LANGUAGE = "python"
DEFAULT_VISIBILITY = ("public",)

ResponseFile = dict[str, object]


def _empty_response(file_path: str) -> ResponseFile:
    return {
        "filePath": file_path,
        "symbols": [],
        "undocumentedSymbols": [],
        "links": [],
        "diagnostics": [],
    }


def _sentence(message: str) -> str:
    return message if message.endswith(".") else message + "."


def _parse_error(file_path: str, message: str, position: dict[str, int]) -> ResponseFile:
    response = _empty_response(file_path)
    response["diagnostics"] = [
        {
            "severity": "error",
            "code": "code_parse_error",
            "target": file_path,
            "language": LANGUAGE,
            "message": "Python parse error: " + _sentence(message),
            "location": make_location(file_path, position),
        }
    ]
    return response


def _syntax_error_position(error: SyntaxError, table: LineTable) -> dict[str, int]:
    if error.lineno is None or error.offset is None:
        return {"line": 1, "column": 1}
    return {"line": error.lineno, "column": table.column_from_offset(error.lineno, error.offset)}


def _tokenize_error_position(error: tokenize.TokenError, table: LineTable) -> dict[str, int]:
    if len(error.args) >= 2 and isinstance(error.args[1], tuple) and len(error.args[1]) == 2:
        row, col = error.args[1]
        return table.position_from_chars(row, col)
    return {"line": 1, "column": 1}


def scan_file(file_path: str, content: str, visibility: list[str] | None) -> ResponseFile:
    """Scan one file. ``None`` visibility means the default ``["public"]``."""
    table = LineTable(content)
    try:
        module = ast.parse(table.parse_text, file_path, type_comments=False)
    except SyntaxError as error:
        return _parse_error(
            file_path, error.msg or str(error), _syntax_error_position(error, table)
        )
    except (ValueError, RecursionError) as error:
        return _parse_error(file_path, str(error), {"line": 1, "column": 1})
    try:
        tokens = TokenIndex.from_text(table.parse_text)
    except tokenize.TokenError as error:
        message = error.args[0] if error.args else str(error)
        return _parse_error(file_path, str(message), _tokenize_error_position(error, table))
    except SyntaxError as error:
        return _parse_error(
            file_path, error.msg or str(error), _syntax_error_position(error, table)
        )

    entries = DeclarationCollector(table, tokens).collect(module)
    visible = set(DEFAULT_VISIBILITY if visibility is None else visibility)
    return ResponseBuilder(file_path, visible).build(entries)


class ResponseBuilder:
    """Turns collected entries into the worker's per-file response."""

    def __init__(self, file_path: str, visible: set[str]) -> None:
        self.file_path = file_path
        self.visible = visible
        self.response = _empty_response(file_path)
        self.symbols: list[dict[str, object]] = []
        self.undocumented: list[dict[str, object]] = []
        self.links: list[dict[str, object]] = []
        self.diagnostics: list[dict[str, object]] = []

    def build(self, entries: list[Entry]) -> ResponseFile:
        for entry in entries:
            if isinstance(entry, UnsupportedEntry):
                self._unsupported(entry.range)
            else:
                self._declaration(entry)
        self.response["symbols"] = self.symbols
        self.response["undocumentedSymbols"] = self.undocumented
        self.response["links"] = self.links
        self.response["diagnostics"] = self.diagnostics
        return self.response

    def _unsupported(self, name_range: dict[str, dict[str, int]]) -> None:
        self.diagnostics.append(
            {
                "severity": "warning",
                "code": "unsupported_declaration",
                "target": self.file_path,
                "language": LANGUAGE,
                "message": "Python declaration annotated with @doc is not supported.",
                "location": make_location(self.file_path, name_range["start"]),
                "range": name_range,
            }
        )

    def _declaration(self, entry: DeclarationEntry) -> None:
        visibility_class = "private" if entry.private else "public"
        if visibility_class not in self.visible:
            for member in entry.members + entry.duplicates:
                if member.targets:
                    self._unsupported(member.name_range)
            return

        endpoint = f"{self.file_path}#{entry.canonical_id}"
        symbol = self._symbol(entry, entry.members[0], endpoint)
        # The group's members document the endpoint together; each annotated
        # non-grouped repeat is a further annotated declaration of it. Only the
        # first annotated one links; every later one is a duplicate.
        group_targets = [target for member in entry.members for target in member.targets]
        annotated_repeats = [member for member in entry.duplicates if member.targets]
        if group_targets:
            targets, duplicates = group_targets, annotated_repeats
        elif annotated_repeats:
            targets, duplicates = annotated_repeats[0].targets, annotated_repeats[1:]
        else:
            self.undocumented.append(symbol)
            return
        self.symbols.append(symbol)
        self._links(endpoint, targets)
        for duplicate in duplicates:
            self._duplicate_code_symbol(endpoint, duplicate)

    def _symbol(self, entry: DeclarationEntry, member: Member, endpoint: str) -> dict[str, object]:
        return {
            "kind": "code",
            "language": LANGUAGE,
            "filePath": self.file_path,
            "symbolName": entry.symbol_name,
            "canonicalId": entry.canonical_id,
            "endpoint": endpoint,
            "location": make_location(self.file_path, member.name_range["start"]),
            "nameRange": member.name_range,
            "declarationRange": member.declaration_range,
            "signatureRange": member.signature_range,
        }

    def _duplicate_code_symbol(self, endpoint: str, member: Member) -> None:
        self.diagnostics.append(
            {
                "severity": "error",
                "code": "duplicate_code_symbol",
                "target": endpoint,
                "language": LANGUAGE,
                "message": "Duplicate Python code symbol endpoint: " + endpoint,
                "location": make_location(self.file_path, member.name_range["start"]),
                "range": member.name_range,
            }
        )

    def _links(self, endpoint: str, targets: list[DocTarget]) -> None:
        seen: set[str] = set()
        for target in targets:
            location = make_location(self.file_path, target.start)
            target_range = {"start": target.start, "end": target.end}
            if not is_valid_link_target(target.target, self.file_path):
                self.diagnostics.append(
                    {
                        "severity": "error",
                        "code": "invalid_link_target",
                        "target": target.target,
                        "language": LANGUAGE,
                        "source": endpoint,
                        "message": INVALID_LINK_TARGET_MESSAGE,
                        "location": location,
                        "range": target_range,
                    }
                )
                continue
            if target.target in seen:
                self.diagnostics.append(
                    {
                        "severity": "warning",
                        "code": "duplicate_link",
                        "target": target.target,
                        "language": LANGUAGE,
                        "source": endpoint,
                        "message": f"Duplicate @doc link from {endpoint} to {target.target}.",
                        "location": location,
                        "range": target_range,
                    }
                )
                continue
            seen.add(target.target)
            self.links.append(
                {
                    "source": endpoint,
                    "target": target.target,
                    "location": location,
                    "targetRange": target_range,
                }
            )
