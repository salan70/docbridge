"""Table-driven tests for `scan_file`, the per-file Python scanner."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from docbridge_python_scanner.scanner import scan_file

FILE_PATH = "input.py"


def scan(source, visibility=None):
    return scan_file(FILE_PATH, source, visibility)


def ids(symbols):
    return [symbol["canonicalId"] for symbol in symbols]


def codes(diagnostics):
    return [diagnostic["code"] for diagnostic in diagnostics]


def position(line, column):
    return {"line": line, "column": column}


def span(start_line, start_column, end_line, end_column):
    return {"start": position(start_line, start_column), "end": position(end_line, end_column)}


def location(line, column):
    return {"filePath": FILE_PATH, "line": line, "column": column}


VISIBILITY_SOURCE = """\
def login(): ...
async def fetch(): ...
class Client:
    def login(self): ...
    class Inner:
        def run(self): ...
    def _hidden(self): ...
    def __init__(self): ...
class _Private:
    def visible(self): ...
def _helper(): ...
def __dunder__(): ...
"""

PUBLIC_IDS = [
    "login",
    "fetch",
    "Client",
    "Client.login",
    "Client.Inner",
    "Client.Inner.run",
    "Client.__init__",
    "__dunder__",
]
PRIVATE_IDS = ["Client._hidden", "_Private", "_Private.visible", "_helper"]


class CanonicalIdsAndVisibilityTest(unittest.TestCase):
    def test_visibility_filters(self):
        cases = [
            ("omitted", None, PUBLIC_IDS),
            ("empty", [], []),
            ("public", ["public"], PUBLIC_IDS),
            ("private", ["private"], PRIVATE_IDS),
            (
                "both",
                ["public", "private"],
                [
                    "login",
                    "fetch",
                    "Client",
                    "Client.login",
                    "Client.Inner",
                    "Client.Inner.run",
                    "Client._hidden",
                    "Client.__init__",
                    "_Private",
                    "_Private.visible",
                    "_helper",
                    "__dunder__",
                ],
            ),
            ("unknown value", ["exported"], []),
        ]
        for name, visibility, expected in cases:
            with self.subTest(name):
                result = scan(VISIBILITY_SOURCE, visibility)
                self.assertEqual(ids(result["undocumentedSymbols"]), expected)
                self.assertEqual(result["symbols"], [])
                self.assertEqual(result["links"], [])
                self.assertEqual(result["diagnostics"], [])

    def test_symbol_shape(self):
        result = scan("class Client:\n    def login(self):\n        pass\n")
        self.assertEqual(
            result["undocumentedSymbols"][1],
            {
                "kind": "code",
                "language": "python",
                "filePath": FILE_PATH,
                "symbolName": "login",
                "canonicalId": "Client.login",
                "endpoint": "input.py#Client.login",
                "location": location(2, 9),
                "nameRange": span(2, 9, 2, 14),
                "declarationRange": span(2, 5, 3, 13),
                "signatureRange": span(2, 5, 2, 21),
            },
        )

    def test_annotated_symbol_outside_the_filter_is_unsupported(self):
        source = (
            "# @doc docs/a.md#helper\n"
            "def _helper(): ...\n"
            "class _Private:\n"
            "    def visible(self):\n"
            '        """@doc docs/a.md#visible"""\n'
        )
        result = scan(source)
        self.assertEqual(result["symbols"], [])
        self.assertEqual(result["undocumentedSymbols"], [])
        self.assertEqual(result["links"], [])
        self.assertEqual(
            result["diagnostics"],
            [
                {
                    "severity": "warning",
                    "code": "unsupported_declaration",
                    "target": FILE_PATH,
                    "language": "python",
                    "message": "Python declaration annotated with @doc is not supported.",
                    "location": location(2, 5),
                    "range": span(2, 5, 2, 12),
                },
                {
                    "severity": "warning",
                    "code": "unsupported_declaration",
                    "target": FILE_PATH,
                    "language": "python",
                    "message": "Python declaration annotated with @doc is not supported.",
                    "location": location(4, 9),
                    "range": span(4, 9, 4, 16),
                },
            ],
        )
        self.assertEqual(ids(scan(source, ["private"])["symbols"]), ["_helper", "_Private.visible"])


class RangesTest(unittest.TestCase):
    def test_declaration_and_signature_ranges(self):
        cases = [
            (
                "comment, decorator, body",
                "# lead\n# @doc docs/a.md#login\n@decorator\ndef login(a, b=1) -> int:\n"
                '    """Doc."""\n    return a\n',
                span(4, 5, 4, 10),
                span(1, 1, 6, 13),
                span(1, 1, 4, 26),
            ),
            (
                "decorator only",
                "@decorator\ndef login():\n    pass\n",
                span(2, 5, 2, 10),
                span(1, 1, 3, 9),
                span(1, 1, 2, 13),
            ),
            (
                "keyword only",
                "def login():\n    pass\n",
                span(1, 5, 1, 10),
                span(1, 1, 2, 9),
                span(1, 1, 1, 13),
            ),
            (
                "async keyword",
                "async def login():\n    pass\n",
                span(1, 11, 1, 16),
                span(1, 1, 2, 9),
                span(1, 1, 1, 19),
            ),
            (
                "class with bases",
                "class Login(Base, metaclass=Meta):\n    x = 1\n",
                span(1, 7, 1, 12),
                span(1, 1, 2, 10),
                span(1, 1, 1, 35),
            ),
            (
                "colon inside the header does not end the signature",
                "def login(f=lambda: 0, d={'a': 1}) -> dict[str, int]:\n    pass\n",
                span(1, 5, 1, 10),
                span(1, 1, 2, 9),
                span(1, 1, 1, 54),
            ),
            (
                "multi-line header",
                "def login(\n    a,\n    b,\n):\n    pass\n",
                span(1, 5, 1, 10),
                span(1, 1, 5, 9),
                span(1, 1, 4, 3),
            ),
            (
                "comment above a class member starts at its column",
                "class A:\n    # @doc docs/a.md#f\n    def f(self):\n        pass\n",
                span(3, 9, 3, 10),
                span(2, 5, 4, 13),
                span(2, 5, 3, 17),
            ),
            (
                "comment above the decorator of a member",
                "class A:\n    # note\n    @staticmethod\n    def f():\n        pass\n",
                span(4, 9, 4, 10),
                span(2, 5, 5, 13),
                span(2, 5, 4, 13),
            ),
            (
                "comment at another column is not part of the declaration",
                "class A:\n  # note\n    def f(self):\n        pass\n",
                span(3, 9, 3, 10),
                span(3, 5, 4, 13),
                span(3, 5, 3, 17),
            ),
            (
                "blank line separates the comment from the declaration",
                "# note\n\ndef login():\n    pass\n",
                span(3, 5, 3, 10),
                span(3, 1, 4, 9),
                span(3, 1, 3, 13),
            ),
        ]
        for name, source, name_range, declaration_range, signature_range in cases:
            with self.subTest(name):
                result = scan(source)
                symbols = result["symbols"] + result["undocumentedSymbols"]
                symbol = next(s for s in symbols if s["symbolName"] in {"login", "Login", "f"})
                self.assertEqual(symbol["nameRange"], name_range)
                self.assertEqual(symbol["location"], location(**name_range["start"]))
                self.assertEqual(symbol["declarationRange"], declaration_range)
                self.assertEqual(symbol["signatureRange"], signature_range)

    def test_non_ascii_columns_count_utf16_units(self):
        source = (
            "# ログイン 😀\n"
            "# @doc docs/ログイン😀.md#login\n"
            'def ログイン(x="😀") -> str:\n'
            '    return "😀"\n'
        )
        result = scan(source)
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["canonicalId"], "ログイン")
        self.assertEqual(symbol["nameRange"], span(3, 5, 3, 9))
        self.assertEqual(symbol["declarationRange"], span(1, 1, 4, 16))
        self.assertEqual(symbol["signatureRange"], span(1, 1, 3, 25))
        (link,) = result["links"]
        self.assertEqual(link["target"], "docs/ログイン😀.md#login")
        self.assertEqual(link["location"], location(2, 8))
        self.assertEqual(link["targetRange"], span(2, 8, 2, 28))

    def test_crlf_keeps_columns_and_excludes_line_ends(self):
        source = '# @doc docs/a.md#f\r\ndef f():\r\n    """@doc docs/a.md#g"""\r\n    pass\r\n'
        result = scan(source)
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["declarationRange"], span(1, 1, 4, 9))
        self.assertEqual(symbol["signatureRange"], span(1, 1, 2, 9))
        self.assertEqual(
            [(link["target"], link["targetRange"]) for link in result["links"]],
            [("docs/a.md#f", span(1, 8, 1, 19)), ("docs/a.md#g", span(3, 13, 3, 24))],
        )
        self.assertEqual(result["diagnostics"], [])

    def test_bom_counts_as_the_first_character_of_line_one(self):
        source = "\ufeff# @doc docs/a.md#f\ndef f():\n    pass\n"
        result = scan(source)
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["location"], location(2, 5))
        self.assertEqual(symbol["declarationRange"], span(1, 2, 3, 9))
        (link,) = result["links"]
        self.assertEqual(link["targetRange"], span(1, 9, 1, 20))
        self.assertEqual(result["diagnostics"], [])

    def test_bom_before_a_declaration_on_line_one(self):
        result = scan('\ufeffdef f():\n    """@doc docs/a.md#f"""\n')
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["nameRange"], span(1, 6, 1, 7))
        self.assertEqual(symbol["signatureRange"], span(1, 2, 1, 10))

    def test_crlf_multi_line_docstring_positions(self):
        source = 'def f():\r\n    """Summary.\r\n\r\n    @doc docs/a.md#f\r\n    """\r\n'
        result = scan(source)
        (link,) = result["links"]
        self.assertEqual(link["targetRange"], span(4, 10, 4, 21))
        self.assertEqual(result["symbols"][0]["declarationRange"], span(1, 1, 5, 8))

    def test_decorated_class_with_leading_comment(self):
        source = "# @doc docs/a.md#c\n@dataclass\nclass C:\n    x: int\n"
        result = scan(source)
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["nameRange"], span(3, 7, 3, 8))
        self.assertEqual(symbol["declarationRange"], span(1, 1, 4, 11))
        self.assertEqual(symbol["signatureRange"], span(1, 1, 3, 9))
        self.assertEqual(result["diagnostics"], [])


class AnnotationSourcesTest(unittest.TestCase):
    def test_docstring_targets(self):
        cases = [
            (
                "target directly followed by the closing quotes",
                'def f():\n    """@doc docs/a.md#f"""\n',
                [("docs/a.md#f", span(2, 13, 2, 24))],
            ),
            (
                "single-quoted docstring",
                "def f():\n    '@doc docs/a.md#f'\n",
                [("docs/a.md#f", span(2, 11, 2, 22))],
            ),
            (
                "raw docstring prefix is excluded",
                'def f():\n    r"""@doc docs/a.md#f"""\n',
                [("docs/a.md#f", span(2, 14, 2, 25))],
            ),
            (
                "multi-line docstring",
                'def f():\n    """Summary.\n\n    @doc docs/a.md#f\n'
                '    @doc docs/a.md#g\n    """\n',
                [("docs/a.md#f", span(4, 10, 4, 21)), ("docs/a.md#g", span(5, 10, 5, 21))],
            ),
            (
                "class docstring",
                'class A:\n    """@doc docs/a.md#a"""\n',
                [("docs/a.md#a", span(2, 13, 2, 24))],
            ),
            (
                "docstring on the header line",
                'def f(): """@doc docs/a.md#f"""\n',
                [("docs/a.md#f", span(1, 18, 1, 29))],
            ),
            (
                "@doc without a target is not a link",
                'def f():\n    """@doc"""\n',
                [],
            ),
            (
                "a string that is not the first statement is not a docstring",
                'def f():\n    x = 1\n    """@doc docs/a.md#f"""\n',
                [],
            ),
            (
                "parenthesized docstring excludes the parentheses",
                'def f():\n    ("@doc docs/a.md#f")\n',
                [("docs/a.md#f", span(2, 12, 2, 23))],
            ),
            (
                "implicitly concatenated literals are searched one by one",
                'def f():\n    "@doc docs/a.md#f" "@doc docs/a.md#g"\n',
                [("docs/a.md#f", span(2, 11, 2, 22)), ("docs/a.md#g", span(2, 30, 2, 41))],
            ),
            (
                "a target never continues into the next literal",
                'def f():\n    "@doc " "docs/a.md#f"\n',
                [],
            ),
            (
                "parenthesized multi-line concatenation with prefixes and a comment",
                "def f():\n"
                "    (\n"
                '        u"@doc docs/a.md#f"  # @doc docs/a.md#comment\n'
                "        R'''@doc docs/a.md#g'''\n"
                "    )\n",
                [("docs/a.md#f", span(3, 16, 3, 27)), ("docs/a.md#g", span(4, 18, 4, 29))],
            ),
            (
                "an f-string is never a docstring",
                'def f():\n    f"@doc docs/a.md#f"\n',
                [],
            ),
            (
                "a leading f-string makes the concatenation no docstring",
                'def f():\n    rf"@doc docs/a.md#f" "@doc docs/a.md#g"\n',
                [],
            ),
            (
                "a later f-string makes the concatenation no docstring",
                'def f():\n    "@doc docs/a.md#f" f"x"\n',
                [],
            ),
        ]
        for name, source, expected in cases:
            with self.subTest(name):
                result = scan(source)
                self.assertEqual(
                    [(link["target"], link["targetRange"]) for link in result["links"]],
                    expected,
                )
                self.assertEqual(result["diagnostics"], [])
                for link in result["links"]:
                    self.assertEqual(link["location"], location(**link["targetRange"]["start"]))

    def test_leading_comment_targets(self):
        cases = [
            (
                "comment directly above the keyword",
                "# @doc docs/a.md#f\ndef f(): ...\n",
                [("docs/a.md#f", span(1, 8, 1, 19))],
            ),
            (
                "comment above the first decorator",
                "# @doc docs/a.md#f\n@decorator\n@other\ndef f(): ...\n",
                [("docs/a.md#f", span(1, 8, 1, 19))],
            ),
            (
                "contiguous run of comment lines",
                "# summary\n# @doc docs/a.md#f\n# @doc docs/a.md#g\ndef f(): ...\n",
                [("docs/a.md#f", span(2, 8, 2, 19)), ("docs/a.md#g", span(3, 8, 3, 19))],
            ),
            (
                "hash inside the comment text is searched too",
                "#@doc docs/a.md#f # trailing\ndef f(): ...\n",
                [("docs/a.md#f", span(1, 7, 1, 18))],
            ),
            (
                "comment between decorators is not a doc comment",
                "@decorator\n# @doc docs/a.md#f\ndef f(): ...\n",
                [],
            ),
            (
                "blank line breaks the run",
                "# @doc docs/a.md#f\n\ndef f(): ...\n",
                [],
            ),
            (
                "comment at another column breaks the run",
                "class A:\n    # @doc docs/a.md#f\n  # other\n    def f(self): ...\n",
                [],
            ),
            (
                "comment at another column below the run is not included",
                "class A:\n  # @doc docs/a.md#f\n    # note\n    def f(self): ...\n",
                [],
            ),
            (
                "trailing comment on the header line is not a doc comment",
                "def f():  # @doc docs/a.md#f\n    pass\n",
                [],
            ),
            (
                "comment inside a function body is ignored",
                "def f():\n    # @doc docs/a.md#f\n    return 1\n",
                [],
            ),
            (
                "comment at the end of the file is ignored",
                "def f(): ...\n# @doc docs/a.md#f\n",
                [],
            ),
        ]
        for name, source, expected in cases:
            with self.subTest(name):
                result = scan(source)
                self.assertEqual(
                    [(link["target"], link["targetRange"]) for link in result["links"]],
                    expected,
                )
                self.assertEqual(result["diagnostics"], [])

    def test_comment_and_docstring_targets_combine_in_source_order(self):
        source = '# @doc docs/a.md#f\ndef f():\n    """@doc docs/a.md#g"""\n'
        result = scan(source)
        self.assertEqual(
            [link["target"] for link in result["links"]], ["docs/a.md#f", "docs/a.md#g"]
        )
        self.assertEqual([link["source"] for link in result["links"]], ["input.py#f", "input.py#f"])


class GroupingTest(unittest.TestCase):
    def test_property_members_share_one_endpoint(self):
        source = (
            "class C:\n"
            "    @property\n"
            "    def value(self):\n"
            '        """@doc docs/c.md#value"""\n'
            "    @value.setter\n"
            "    def value(self, v):\n"
            '        """@doc docs/c.md#value-setter"""\n'
            "    @value.deleter\n"
            "    def value(self): ...\n"
            "    @functools.cached_property\n"
            "    def cached(self): ...\n"
            "    @cached.getter\n"
            "    def cached(self):\n"
            '        """@doc docs/c.md#cached"""\n'
        )
        result = scan(source)
        self.assertEqual(ids(result["symbols"]), ["C.value", "C.cached"])
        self.assertEqual(ids(result["undocumentedSymbols"]), ["C"])
        value, cached = result["symbols"]
        self.assertEqual(value["location"], location(3, 9))
        self.assertEqual(value["declarationRange"], span(2, 5, 4, 35))
        self.assertEqual(value["signatureRange"], span(2, 5, 3, 21))
        self.assertEqual(cached["location"], location(11, 9))
        self.assertEqual(
            [(link["source"], link["target"]) for link in result["links"]],
            [
                ("input.py#C.value", "docs/c.md#value"),
                ("input.py#C.value", "docs/c.md#value-setter"),
                ("input.py#C.cached", "docs/c.md#cached"),
            ],
        )
        self.assertEqual(result["diagnostics"], [])

    def test_overload_stubs_share_the_implementation_endpoint(self):
        source = (
            "@overload\n"
            "def get(a: int) -> int: ...\n"
            "@typing.overload\n"
            "def get(a: str) -> str:\n"
            '    """@doc docs/g.md#get"""\n'
            "def get(a):\n"
            "    return a\n"
        )
        result = scan(source)
        self.assertEqual(ids(result["symbols"]), ["get"])
        self.assertEqual(result["symbols"][0]["location"], location(2, 5))
        self.assertEqual(result["symbols"][0]["declarationRange"], span(1, 1, 2, 28))
        self.assertEqual(
            [(link["source"], link["target"]) for link in result["links"]],
            [("input.py#get", "docs/g.md#get")],
        )
        self.assertEqual(result["diagnostics"], [])

    def test_group_without_annotation_is_one_undocumented_symbol(self):
        source = (
            "class C:\n"
            "    @property\n"
            "    def value(self): ...\n"
            "    @value.setter\n"
            "    def value(self, v): ...\n"
        )
        result = scan(source)
        self.assertEqual(ids(result["undocumentedSymbols"]), ["C", "C.value"])

    def test_same_target_across_members_is_duplicate_link(self):
        source = (
            "class C:\n"
            "    @property\n"
            "    def value(self):\n"
            '        """@doc docs/c.md#value"""\n'
            "    @value.setter\n"
            "    def value(self, v):\n"
            '        """@doc docs/c.md#value"""\n'
        )
        result = scan(source)
        self.assertEqual([link["target"] for link in result["links"]], ["docs/c.md#value"])
        self.assertEqual(
            result["diagnostics"],
            [
                {
                    "severity": "warning",
                    "code": "duplicate_link",
                    "target": "docs/c.md#value",
                    "language": "python",
                    "source": "input.py#C.value",
                    "message": "Duplicate @doc link from input.py#C.value to docs/c.md#value.",
                    "location": location(7, 17),
                    "range": span(7, 17, 7, 32),
                }
            ],
        )

    def test_call_decorators_never_group(self):
        source = (
            "class C:\n"
            "    @property()\n"
            "    def called(self): ...\n"
            "    def called(self):\n"
            '        """@doc docs/c.md#called"""\n'
        )
        result = scan(source)
        self.assertEqual(ids(result["undocumentedSymbols"]), ["C"])
        (called,) = result["symbols"]
        self.assertEqual(called["canonicalId"], "C.called")
        self.assertEqual(called["location"], location(3, 9))
        self.assertEqual([link["target"] for link in result["links"]], ["docs/c.md#called"])
        self.assertEqual(result["diagnostics"], [])

    def test_call_decorator_then_annotated_pair_is_a_duplicate(self):
        source = (
            "class C:\n"
            "    @property()\n"
            "    def called(self):\n"
            '        """@doc docs/c.md#called"""\n'
            "    def called(self):\n"
            '        """@doc docs/c.md#called-again"""\n'
        )
        result = scan(source)
        self.assertEqual(ids(result["symbols"]), ["C.called"])
        self.assertEqual(codes(result["diagnostics"]), ["duplicate_code_symbol"])

    def test_group_outside_the_filter_reports_each_annotated_member(self):
        source = (
            "class C:\n"
            "    @property\n"
            "    def _value(self):\n"
            '        """@doc docs/c.md#value"""\n'
            "    @_value.setter\n"
            "    def _value(self, v):\n"
            '        """@doc docs/c.md#value-setter"""\n'
        )
        result = scan(source)
        self.assertEqual(codes(result["diagnostics"]), ["unsupported_declaration"] * 2)
        self.assertEqual(
            [d["location"] for d in result["diagnostics"]], [location(3, 9), location(6, 9)]
        )


class DeclarationWalkTest(unittest.TestCase):
    def test_conditional_blocks_are_walked_and_function_bodies_are_not(self):
        source = (
            "if sys.version_info >= (3, 11):\n"
            "    def f(): ...\n"
            "else:\n"
            "    def f(): ...\n"
            "try:\n"
            "    def g(): ...\n"
            "except ImportError:\n"
            "    def h(): ...\n"
            "else:\n"
            "    def i(): ...\n"
            "finally:\n"
            "    def j(): ...\n"
            "with ctx():\n"
            "    def k(): ...\n"
            "for _ in range(1):\n"
            "    def l(): ...\n"
            "else:\n"
            "    def m(): ...\n"
            "while False:\n"
            "    def n(): ...\n"
            "else:\n"
            "    def o(): ...\n"
            "match x:\n"
            "    case 1:\n"
            "        def p(): ...\n"
            "    case _:\n"
            "        def q(): ...\n"
            "class K:\n"
            "    if True:\n"
            "        async def r(self): ...\n"
            "    with ctx():\n"
            "        class Inner:\n"
            "            def s(self): ...\n"
            "def outer():\n"
            "    def inner(): ...\n"
            "    class Local: ...\n"
        )
        result = scan(source)
        self.assertEqual(
            ids(result["undocumentedSymbols"]),
            [
                "f",
                "g",
                "h",
                "i",
                "j",
                "k",
                "l",
                "m",
                "n",
                "o",
                "p",
                "q",
                "K",
                "K.r",
                "K.Inner",
                "K.Inner.s",
                "outer",
            ],
        )
        self.assertEqual(result["diagnostics"], [])

    def test_duplicate_code_symbol_needs_two_annotated_declarations(self):
        source = (
            "# @doc docs/a.md#f\n"
            "def f(): ...\n"
            "# @doc docs/a.md#f2\n"
            "def f(): ...\n"
            "def g(): ...\n"
            "# @doc docs/a.md#g\n"
            "def g(): ...\n"
            "def h(): ...\n"
            "def h(): ...\n"
        )
        result = scan(source)
        self.assertEqual(ids(result["symbols"]), ["f", "g"])
        self.assertEqual(ids(result["undocumentedSymbols"]), ["h"])
        self.assertEqual(
            [link["target"] for link in result["links"]], ["docs/a.md#f", "docs/a.md#g"]
        )
        self.assertEqual(
            result["diagnostics"],
            [
                {
                    "severity": "error",
                    "code": "duplicate_code_symbol",
                    "target": "input.py#f",
                    "language": "python",
                    "message": "Duplicate Python code symbol endpoint: input.py#f",
                    "location": location(4, 5),
                    "range": span(4, 5, 4, 6),
                }
            ],
        )

    def test_later_annotated_declaration_documents_the_first_declaration(self):
        source = "def g():\n    pass\n# @doc docs/a.md#g\ndef g(): ...\n"
        result = scan(source)
        (symbol,) = result["symbols"]
        self.assertEqual(symbol["location"], location(1, 5))
        self.assertEqual(symbol["declarationRange"], span(1, 1, 2, 9))
        (link,) = result["links"]
        self.assertEqual(link["location"], location(3, 8))
        self.assertEqual(result["undocumentedSymbols"], [])
        self.assertEqual(result["diagnostics"], [])

    def test_same_name_in_different_containers_is_not_a_duplicate(self):
        source = (
            "# @doc docs/a.md#f\n"
            "def f(): ...\n"
            "class A:\n"
            "    # @doc docs/a.md#af\n"
            "    def f(self): ...\n"
        )
        result = scan(source)
        self.assertEqual(ids(result["symbols"]), ["f", "A.f"])
        self.assertEqual(result["diagnostics"], [])


class UnsupportedDeclarationsTest(unittest.TestCase):
    def test_annotated_unsupported_statements(self):
        source = (
            '"""Module.\n\n@doc docs/m.md#m\n"""\n'
            "# @doc docs/a.md#x\n"
            "x = 1\n"
            "# @doc docs/a.md#y\n"
            "y = lambda: 0\n"
            "# @doc docs/a.md#imp\n"
            "import os\n"
            "class A:\n"
            "    # @doc docs/a.md#field\n"
            "    field: int = 1\n"
            "def outer():\n"
            "    # @doc docs/a.md#inner\n"
            "    def inner(): ...\n"
            "# unrelated\n"
            "z = 2\n"
        )
        result = scan(source)
        self.assertEqual(ids(result["undocumentedSymbols"]), ["A", "outer"])
        self.assertEqual(result["links"], [])
        self.assertEqual(codes(result["diagnostics"]), ["unsupported_declaration"] * 5)
        self.assertEqual(
            [(d["location"], d["range"]) for d in result["diagnostics"]],
            [
                (location(1, 1), span(1, 1, 4, 4)),
                (location(6, 1), span(6, 1, 6, 2)),
                (location(8, 1), span(8, 1, 8, 2)),
                (location(10, 1), span(10, 1, 10, 7)),
                (location(13, 5), span(13, 5, 13, 10)),
            ],
        )
        for diagnostic in result["diagnostics"]:
            self.assertEqual(diagnostic["target"], FILE_PATH)
            self.assertEqual(diagnostic["severity"], "warning")

    def test_module_docstring_after_comments_points_at_its_token(self):
        result = scan('# header\n\n"""@doc docs/m.md#m"""\n')
        (diagnostic,) = result["diagnostics"]
        self.assertEqual(diagnostic["code"], "unsupported_declaration")
        self.assertEqual(diagnostic["location"], location(3, 1))
        self.assertEqual(diagnostic["range"], span(3, 1, 3, 23))


class LinkTargetsTest(unittest.TestCase):
    def test_invalid_targets(self):
        source = (
            "def f():\n"
            '    """\n'
            "    @doc nohash\n"
            "    @doc a#b#c\n"
            "    @doc ./a.md#x\n"
            "    @doc /abs.md#x\n"
            "    @doc ../a.md#x\n"
            "    @doc a/../b.md#x\n"
            "    @doc a.md#\n"
            "    @doc #x\n"
            "    @doc a\\\\b.md#x\n"
            "    @doc input.py#f\n"
            "    @doc docs/a.md#ok\n"
            '    """\n'
        )
        result = scan(source)
        self.assertEqual([link["target"] for link in result["links"]], ["docs/a.md#ok"])
        self.assertEqual(codes(result["diagnostics"]), ["invalid_link_target"] * 10)
        self.assertEqual(
            result["diagnostics"][0],
            {
                "severity": "error",
                "code": "invalid_link_target",
                "target": "nohash",
                "language": "python",
                "source": "input.py#f",
                "message": "Link target must be a project-root-relative file path and fragment "
                "in file#fragment form.",
                "location": location(3, 10),
                "range": span(3, 10, 3, 16),
            },
        )
        self.assertEqual(
            [d["target"] for d in result["diagnostics"]],
            [
                "nohash",
                "a#b#c",
                "./a.md#x",
                "/abs.md#x",
                "../a.md#x",
                "a/../b.md#x",
                "a.md#",
                "#x",
                "a\\\\b.md#x",
                "input.py#f",
            ],
        )

    def test_only_ascii_whitespace_separates_a_target(self):
        target = [("docs/a.md#f", span(1, 8, 1, 19))]
        cases = [
            ("space", "# @doc docs/a.md#f\ndef f(): ...\n", target),
            ("tab", "# @doc\tdocs/a.md#f\ndef f(): ...\n", target),
            ("form feed", "# @doc\fdocs/a.md#f\ndef f(): ...\n", target),
            ("vertical tab", "# @doc\vdocs/a.md#f\ndef f(): ...\n", target),
            ("no-break space after @doc", "# @doc\u00a0docs/a.md#f\ndef f(): ...\n", []),
            ("ideographic space after @doc", "# @doc\u3000docs/a.md#f\ndef f(): ...\n", []),
            ("information separator after @doc", "# @doc\x1cdocs/a.md#f\ndef f(): ...\n", []),
            (
                "no-break space inside a comment target is part of it",
                "# @doc docs/a\u00a0b.md#f\ndef f(): ...\n",
                [("docs/a\u00a0b.md#f", span(1, 8, 1, 21))],
            ),
            (
                "no-break space inside a docstring target is part of it",
                'def f():\n    """@doc docs/a.md#f\u00a0g"""\n',
                [("docs/a.md#f\u00a0g", span(2, 13, 2, 26))],
            ),
        ]
        for name, source, expected in cases:
            with self.subTest(name):
                result = scan(source)
                self.assertEqual(
                    [(link["target"], link["targetRange"]) for link in result["links"]],
                    expected,
                )
                self.assertEqual(result["diagnostics"], [])

    def test_duplicate_target_on_one_declaration(self):
        result = scan("# @doc docs/a.md#f\n# @doc docs/a.md#f\ndef f(): ...\n")
        self.assertEqual(len(result["links"]), 1)
        (diagnostic,) = result["diagnostics"]
        self.assertEqual(diagnostic["code"], "duplicate_link")
        self.assertEqual(diagnostic["location"], location(2, 8))


class ParseErrorTest(unittest.TestCase):
    def test_syntax_errors(self):
        cases = [
            ("invalid syntax", "def f(:\n", "invalid syntax", 1, 7),
            (
                "offset after a non-BMP character counts UTF-16 units",
                'x = "😀" )\n',
                "unmatched ')'",
                1,
                10,
            ),
            ("crlf lines", "def f():\r\n    pass\r\nx = )\r\n", "unmatched ')'", 3, 5),
            ("bom", "\ufeffx = )\n", "unmatched ')'", 1, 6),
            ("unexpected indent", "x = 1\n    y = 2\n", "unexpected indent", 2, 4),
        ]
        for name, source, message, line, column in cases:
            with self.subTest(name):
                result = scan(source)
                self.assertEqual(result["symbols"], [])
                self.assertEqual(result["undocumentedSymbols"], [])
                self.assertEqual(result["links"], [])
                self.assertEqual(
                    result["diagnostics"],
                    [
                        {
                            "severity": "error",
                            "code": "code_parse_error",
                            "target": FILE_PATH,
                            "language": "python",
                            "message": f"Python parse error: {message}.",
                            "location": location(line, column),
                        }
                    ],
                )

    def test_null_byte_is_a_parse_error_at_the_file_start(self):
        result = scan("x = 1\x00\n")
        (diagnostic,) = result["diagnostics"]
        self.assertEqual(diagnostic["code"], "code_parse_error")
        self.assertIn("null bytes", diagnostic["message"])
        self.assertEqual(diagnostic["location"], location(1, 1))

    def test_empty_file(self):
        result = scan("")
        self.assertEqual(
            result,
            {
                "filePath": FILE_PATH,
                "symbols": [],
                "undocumentedSymbols": [],
                "links": [],
                "diagnostics": [],
            },
        )


if __name__ == "__main__":
    unittest.main()
