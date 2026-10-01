"""Tests for the worker protocol: stdin/stdout JSON, `--probe`, and exit codes.

The subprocess tests run the entrypoint exactly as the core does
(`python3 -I -S <entrypoint>`), so they also cover the `sys.path` insertion
the isolated mode requires. `tests/cases/*.json` are request/response pairs
replayed through that same command.
"""

import glob
import json
import os
import platform
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from docbridge_python_scanner.protocol import scan_request

PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRYPOINT = os.path.join(PACKAGE_ROOT, "docbridge_python_scanner.py")
CASES_DIR = os.path.join(PACKAGE_ROOT, "tests", "cases")


def run_worker(stdin_text, *args):
    return subprocess.run(
        [sys.executable, "-I", "-S", ENTRYPOINT, *args],
        input=stdin_text.encode("utf-8"),
        capture_output=True,
        check=False,
    )


def request(files, options=None):
    return {
        "schemaVersion": 1,
        "requestId": "req-1",
        "language": "python",
        "projectRoot": "/project",
        "files": files,
        "options": {} if options is None else options,
    }


class ScanRequestTest(unittest.TestCase):
    def test_files_are_scanned_in_request_order(self):
        response = scan_request(
            request(
                [
                    {"filePath": "b.py", "content": "def b(): ...\n"},
                    {"filePath": "a.py", "content": "def a(: ...\n"},
                    {"filePath": "c.py", "content": ""},
                ]
            )
        )
        self.assertEqual(response["schemaVersion"], 1)
        self.assertEqual(response["requestId"], "req-1")
        self.assertEqual(response["language"], "python")
        self.assertEqual([file["filePath"] for file in response["files"]], ["b.py", "a.py", "c.py"])
        self.assertEqual(
            [symbol["canonicalId"] for symbol in response["files"][0]["undocumentedSymbols"]],
            ["b"],
        )
        self.assertEqual(
            [diagnostic["code"] for diagnostic in response["files"][1]["diagnostics"]],
            ["code_parse_error"],
        )

    def test_visibility_option_is_forwarded(self):
        files = [{"filePath": "a.py", "content": "def _a(): ...\ndef b(): ...\n"}]
        default = scan_request(request(files))
        private = scan_request(request(files, {"visibility": ["private"]}))
        self.assertEqual(
            [s["canonicalId"] for s in default["files"][0]["undocumentedSymbols"]], ["b"]
        )
        self.assertEqual(
            [s["canonicalId"] for s in private["files"][0]["undocumentedSymbols"]], ["_a"]
        )


class EntrypointTest(unittest.TestCase):
    def test_scan_round_trip_through_stdin_and_stdout(self):
        payload = request([{"filePath": "a.py", "content": "# @doc docs/a.md#a\ndef a(): ...\n"}])
        result = run_worker(json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        stdout = result.stdout.decode("utf-8")
        self.assertTrue(stdout.endswith("\n"))
        response = json.loads(stdout)
        self.assertEqual(response, scan_request(payload))
        self.assertEqual(response["files"][0]["links"][0]["target"], "docs/a.md#a")

    def test_non_ascii_content_survives_the_round_trip(self):
        payload = request(
            [
                {
                    "filePath": "a.py",
                    "content": 'def ログイン():\n    """@doc docs/ログイン😀.md#x"""\n',
                }
            ]
        )
        result = run_worker(json.dumps(payload, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout.decode("utf-8"))
        self.assertEqual(response["files"][0]["symbols"][0]["canonicalId"], "ログイン")
        self.assertEqual(response["files"][0]["links"][0]["target"], "docs/ログイン😀.md#x")

    def test_probe_reports_the_cpython_runtime(self):
        result = run_worker("", "--probe")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.decode("utf-8").splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(
            json.loads(lines[0]),
            {"ok": True, "runtime": "cpython", "version": platform.python_version()},
        )

    def test_unusable_input_exits_non_zero(self):
        cases = [
            ("invalid JSON", "{not json"),
            ("wrong schema version", json.dumps({**request([]), "schemaVersion": 2})),
            ("missing files", json.dumps({"schemaVersion": 1, "requestId": "x"})),
            ("not an object", json.dumps([1, 2])),
        ]
        for name, stdin_text in cases:
            with self.subTest(name):
                result = run_worker(stdin_text)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
                self.assertNotEqual(result.stderr, b"")


class CaseFilesTest(unittest.TestCase):
    def test_case_files_replay_through_the_entrypoint(self):
        case_paths = sorted(glob.glob(os.path.join(CASES_DIR, "*.json")))
        self.assertNotEqual(case_paths, [])
        for case_path in case_paths:
            with self.subTest(os.path.basename(case_path)):
                with open(case_path, encoding="utf-8") as handle:
                    case = json.load(handle)
                result = run_worker(json.dumps(case["request"], ensure_ascii=False))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout.decode("utf-8")), case["response"])


if __name__ == "__main__":
    unittest.main()
