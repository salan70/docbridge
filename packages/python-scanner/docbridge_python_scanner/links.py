"""``@doc`` target extraction and link-target validation."""

from __future__ import annotations

import re
from dataclasses import dataclass

DOC_TARGET_PATTERN = re.compile(r"@doc\s+(\S+)")

INVALID_LINK_TARGET_MESSAGE = (
    "Link target must be a project-root-relative file path and fragment in file#fragment form."
)


@dataclass(frozen=True)
class DocTarget:
    """One ``@doc`` target with the 1-based UTF-16 range of its text."""

    target: str
    start: dict[str, int]
    end: dict[str, int]


@dataclass(frozen=True)
class DocMatch:
    """A target and its code point offsets, relative to the searched text."""

    target: str
    start: int
    end: int


def find_doc_matches(text: str) -> list[DocMatch]:
    """Match ``@doc\\s+(\\S+)`` over ``text`` and return each target's offsets."""
    return [
        DocMatch(target=match.group(1), start=match.start(1), end=match.end(1))
        for match in DOC_TARGET_PATTERN.finditer(text)
    ]


def _has_whitespace(value: str) -> bool:
    return re.search(r"\s", value) is not None


def is_valid_link_target(target: str, source_file_path: str) -> bool:
    """Mirror the core's ``parseLinkTarget`` rules for a ``file#fragment`` target."""
    parts = target.split("#")
    if len(parts) != 2:
        return False
    file_path, fragment = parts
    if not file_path or not fragment:
        return False
    if file_path.startswith(("/", "./", "../")):
        return False
    if "\\" in file_path or _has_whitespace(file_path) or _has_whitespace(fragment):
        return False
    if ".." in file_path.split("/"):
        return False
    return file_path != source_file_path
