"""Declaration walk: supported definitions, grouping, visibility, and ranges.

The walk visits ``def``, ``async def``, and ``class`` at module level and in
class bodies, recursively for classes, descending into ``if``, ``try``,
``with``, ``for``, ``while``, and ``match`` blocks at those levels and never
into function bodies.

Each endpoint collects its declarations in source order. A declaration is a
single definition or a group, and a group is either a property chain (a
``property`` or ``cached_property`` getter followed by functions of the same
name decorated ``@<name>.getter``, ``.setter``, or ``.deleter``) or a run of
consecutive ``overload`` stubs plus at most one implementation, the first
following function of that name not decorated ``overload``. A same-name
definition that a group does not accept closes it and starts the next
declaration of the endpoint, which repeats it.
"""

from __future__ import annotations

import ast
import enum
import tokenize
from dataclasses import dataclass

from .comments import (
    TokenIndex,
    comment_block_targets,
    docstring_node,
    docstring_targets,
)
from .links import DocTarget
from .positions import LineTable

PROPERTY_DECORATORS = frozenset({"property", "cached_property"})
ACCESSOR_ATTRIBUTES = frozenset({"getter", "setter", "deleter"})
OVERLOAD_DECORATORS = frozenset({"overload"})
OPENING_BRACKETS = frozenset({"(", "[", "{"})
CLOSING_BRACKETS = frozenset({")", "]", "}"})

DefinitionNode = ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef


@dataclass
class Member:
    """One ``def`` / ``async def`` / ``class`` node contributing to an endpoint."""

    name_range: dict[str, dict[str, int]]
    declaration_range: dict[str, dict[str, int]]
    signature_range: dict[str, dict[str, int]]
    targets: list[DocTarget]


class GroupState(enum.Enum):
    """Whether a declaration still accepts later same-name definitions."""

    CLOSED = enum.auto()
    PROPERTY_CHAIN = enum.auto()
    OVERLOAD_STUBS = enum.auto()


@dataclass
class Declaration:
    """One declaration of an endpoint: a single definition or a group."""

    members: list[Member]
    state: GroupState

    @classmethod
    def start(cls, member: Member, node: DefinitionNode) -> Declaration:
        """Start a declaration; a property getter or overload stub opens a group."""
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return cls([member], GroupState.CLOSED)
        if has_named_decorator(node, OVERLOAD_DECORATORS):
            return cls([member], GroupState.OVERLOAD_STUBS)
        if has_named_decorator(node, PROPERTY_DECORATORS):
            return cls([member], GroupState.PROPERTY_CHAIN)
        return cls([member], GroupState.CLOSED)

    @property
    def targets(self) -> list[DocTarget]:
        return [target for member in self.members for target in member.targets]

    @property
    def first_annotated_member(self) -> Member:
        return next(member for member in self.members if member.targets)

    def accepts(self, node: DefinitionNode) -> bool:
        """Whether ``node``, a later definition of the same name, joins this group."""
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return False
        if self.state is GroupState.PROPERTY_CHAIN:
            return is_property_accessor(node)
        return self.state is GroupState.OVERLOAD_STUBS

    def join(self, member: Member, node: DefinitionNode) -> None:
        """Add an accepted definition; an implementation closes an overload group."""
        self.members.append(member)
        if self.state is GroupState.OVERLOAD_STUBS and not has_named_decorator(
            node, OVERLOAD_DECORATORS
        ):
            self.state = GroupState.CLOSED


@dataclass
class DeclarationEntry:
    """A supported endpoint: its first member owns the ranges."""

    symbol_name: str
    canonical_id: str
    private: bool
    declarations: list[Declaration]

    @property
    def members(self) -> list[Member]:
        return [member for declaration in self.declarations for member in declaration.members]

    def add(self, member: Member, node: DefinitionNode) -> None:
        """Join the open group that accepts ``node``, else start a new declaration."""
        last = self.declarations[-1] if self.declarations else None
        if last is not None and last.accepts(node):
            last.join(member, node)
        else:
            self.declarations.append(Declaration.start(member, node))


@dataclass
class UnsupportedEntry:
    """A statement that is not a supported declaration but carries ``@doc``."""

    range: dict[str, dict[str, int]]
    targets: list[DocTarget]


Entry = DeclarationEntry | UnsupportedEntry


def is_dunder(name: str) -> bool:
    return len(name) > 4 and name.startswith("__") and name.endswith("__")


def is_private_name(name: str) -> bool:
    return name.startswith("_") and not is_dunder(name)


def decorator_name(decorator: ast.expr) -> str | None:
    """The last segment of a ``Name`` or ``Attribute`` decorator; ``Call`` has none."""
    if isinstance(decorator, ast.Name):
        return decorator.id
    if isinstance(decorator, ast.Attribute):
        return decorator.attr
    return None


def has_named_decorator(node: DefinitionNode, names: frozenset[str]) -> bool:
    return any(decorator_name(decorator) in names for decorator in node.decorator_list)


def is_property_accessor(node: DefinitionNode) -> bool:
    """Decorated ``@<name>.getter``, ``.setter``, or ``.deleter`` with its own name."""
    return any(
        isinstance(decorator, ast.Attribute)
        and decorator.attr in ACCESSOR_ATTRIBUTES
        and isinstance(decorator.value, ast.Name)
        and decorator.value.id == node.name
        for decorator in node.decorator_list
    )


class DeclarationCollector:
    """Collects entries in source order for one parsed file.

    Endpoints are kept per file, keyed by canonical ID, so a class declared
    twice (an ``if``/``else`` pair, say) contributes the members of both
    bodies to the same member endpoints.
    """

    def __init__(self, table: LineTable, tokens: TokenIndex) -> None:
        self.table = table
        self.tokens = tokens
        self.entries: list[Entry] = []
        self.endpoints: dict[str, DeclarationEntry] = {}

    def collect(self, module: ast.Module) -> list[Entry]:
        self._module_docstring(module)
        self._walk(module.body, prefix="", private=False)
        return self.entries

    def _module_docstring(self, module: ast.Module) -> None:
        docstring = docstring_node(module.body)
        if docstring is None:
            return
        targets = docstring_targets(docstring, self.table, self.tokens)
        if targets:
            self.entries.append(UnsupportedEntry(self._node_range(docstring), targets))

    def _walk(self, body: list[ast.stmt], prefix: str, private: bool) -> None:
        for statement in body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self._definition(statement, prefix, private)
                continue
            self._unsupported_statement(statement)
            for block in self._nested_blocks(statement):
                self._walk(block, prefix, private)

    @staticmethod
    def _nested_blocks(statement: ast.stmt) -> list[list[ast.stmt]]:
        if isinstance(statement, (ast.If, ast.For, ast.AsyncFor, ast.While)):
            return [statement.body, statement.orelse]
        if isinstance(statement, (ast.With, ast.AsyncWith)):
            return [statement.body]
        if isinstance(statement, ast.Try) or (
            hasattr(ast, "TryStar") and isinstance(statement, ast.TryStar)
        ):
            handlers = [handler.body for handler in statement.handlers]
            return [statement.body, *handlers, statement.orelse, statement.finalbody]
        if isinstance(statement, ast.Match):
            return [case.body for case in statement.cases]
        return []

    def _unsupported_statement(self, statement: ast.stmt) -> None:
        """Report a leading ``@doc`` comment on a statement that is no declaration."""
        column = self.table.chars_from_bytes(statement.lineno, statement.col_offset)
        block = self.tokens.leading_comment_block(statement.lineno - 1, column)
        targets = comment_block_targets(block, self.table)
        if not targets:
            return
        token = self.tokens.token_at(statement.lineno, column)
        end = token.end if token is not None else (statement.lineno, column)
        self.entries.append(
            UnsupportedEntry(
                {
                    "start": self.table.position_from_chars(statement.lineno, column),
                    "end": self.table.position_from_chars(*end),
                },
                targets,
            )
        )

    def _definition(self, node: DefinitionNode, prefix: str, private: bool) -> None:
        canonical_id = prefix + node.name
        entry = self.endpoints.get(canonical_id)
        if entry is None:
            entry = DeclarationEntry(
                symbol_name=node.name,
                canonical_id=canonical_id,
                private=private or is_private_name(node.name),
                declarations=[],
            )
            self.endpoints[canonical_id] = entry
            self.entries.append(entry)
        entry.add(self._member(node), node)

        if isinstance(node, ast.ClassDef):
            self._walk(
                node.body,
                prefix=canonical_id + ".",
                private=private or is_private_name(node.name),
            )

    def _member(self, node: DefinitionNode) -> Member:
        keyword_col = self.table.chars_from_bytes(node.lineno, node.col_offset)
        first_line = node.decorator_list[0].lineno if node.decorator_list else node.lineno
        block = self.tokens.leading_comment_block(first_line - 1, keyword_col)
        targets = comment_block_targets(block, self.table)
        docstring = docstring_node(node.body)
        if docstring is not None:
            targets.extend(docstring_targets(docstring, self.table, self.tokens))

        start_row = block[0].row if block else first_line
        start = self.table.position_from_chars(start_row, keyword_col)
        name_token, signature_end = self._header_tokens(node, keyword_col)
        end_row = node.end_lineno if node.end_lineno is not None else node.lineno
        end_col = node.end_col_offset if node.end_col_offset is not None else 0

        return Member(
            name_range={
                "start": self.table.position_from_chars(*name_token.start),
                "end": self.table.position_from_chars(*name_token.end),
            },
            declaration_range={
                "start": start,
                "end": self.table.position_from_bytes(end_row, end_col),
            },
            signature_range={"start": start, "end": self.table.position_from_chars(*signature_end)},
            targets=targets,
        )

    def _header_tokens(
        self, node: DefinitionNode, keyword_col: int
    ) -> tuple[tokenize.TokenInfo, tuple[int, int]]:
        """Return the name token and the end of the ``:`` that closes the header."""
        keyword = "class" if isinstance(node, ast.ClassDef) else "def"
        tokens = self.tokens.tokens
        index = self.tokens.index_at(node.lineno, keyword_col)
        while tokens[index].type != tokenize.NAME or tokens[index].string != keyword:
            index += 1
        name_token = tokens[index + 1]

        depth = 0
        for token in tokens[index + 2 :]:
            if token.type != tokenize.OP:
                continue
            if token.string in OPENING_BRACKETS:
                depth += 1
            elif token.string in CLOSING_BRACKETS:
                depth -= 1
            elif token.string == ":" and depth == 0:
                return name_token, token.end
        return name_token, name_token.end

    def _node_range(self, node: ast.stmt) -> dict[str, dict[str, int]]:
        end_row = node.end_lineno if node.end_lineno is not None else node.lineno
        end_col = node.end_col_offset if node.end_col_offset is not None else 0
        return {
            "start": self.table.position_from_bytes(node.lineno, node.col_offset),
            "end": self.table.position_from_bytes(end_row, end_col),
        }
