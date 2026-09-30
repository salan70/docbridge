"""Worker protocol: one JSON request on stdin, one JSON response on stdout.

``--probe`` prints one JSON line describing the runtime and exits 0 whether or
not the runtime is usable, so this module stays importable on older Pythons:
it uses no 3.10-only syntax and imports the scanner only for a scan.
"""

from __future__ import annotations

import json
import platform
import sys

SCHEMA_VERSION = 1
LANGUAGE = "python"
RUNTIME_FLOOR = (3, 10)


class ProtocolError(Exception):
    """The request cannot be scanned; the worker exits non-zero."""


def probe() -> dict[str, object]:
    """Describe the interpreter: CPython identity and the 3.10 floor."""
    implementation = platform.python_implementation()
    version = platform.python_version()
    if implementation != "CPython":
        return {"ok": False, "reason": f"expected CPython, found {implementation} {version}"}
    if sys.version_info < RUNTIME_FLOOR:
        floor = ".".join(str(part) for part in RUNTIME_FLOOR)
        return {"ok": False, "reason": f"CPython {version} is below the {floor} floor"}
    return {"ok": True, "runtime": "cpython", "version": version}


def parse_request(raw: bytes) -> dict[str, object]:
    """Decode and validate the request shape the scanner relies on."""
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise ProtocolError(f"request is not valid JSON: {error}") from error
    if not isinstance(request, dict):
        raise ProtocolError("request must be a JSON object")
    if request.get("schemaVersion") != SCHEMA_VERSION:
        raise ProtocolError(
            f"unsupported schemaVersion {request.get('schemaVersion')!r}; expected {SCHEMA_VERSION}"
        )
    files = request.get("files")
    if not isinstance(files, list):
        raise ProtocolError("request.files must be an array")
    for index, file in enumerate(files):
        if (
            not isinstance(file, dict)
            or not isinstance(file.get("filePath"), str)
            or not isinstance(file.get("content"), str)
        ):
            raise ProtocolError(f"request.files[{index}] must hold filePath and content strings")
    options = request.get("options")
    if options is not None and not isinstance(options, dict):
        raise ProtocolError("request.options must be an object")
    visibility = (options or {}).get("visibility")
    if visibility is not None and (
        not isinstance(visibility, list) or not all(isinstance(v, str) for v in visibility)
    ):
        raise ProtocolError("request.options.visibility must be an array of strings")
    return request


def scan_request(request: dict[str, object]) -> dict[str, object]:
    """Scan every requested file in request order."""
    from .scanner import scan_file

    options = request.get("options") or {}
    visibility = options.get("visibility") if isinstance(options, dict) else None
    files = request.get("files")
    scanned = [
        scan_file(file["filePath"], file["content"], visibility)
        for file in (files if isinstance(files, list) else [])
    ]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "requestId": request.get("requestId"),
        "language": LANGUAGE,
        "files": scanned,
    }


def _write_json_line(payload: dict[str, object]) -> None:
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()


def main(argv: list[str]) -> int:
    if argv == ["--probe"]:
        _write_json_line(probe())
        return 0
    if argv:
        sys.stderr.write("docbridge-python-scanner: usage: [--probe] < request.json\n")
        return 2
    try:
        request = parse_request(sys.stdin.buffer.read())
    except ProtocolError as error:
        sys.stderr.write(f"docbridge-python-scanner: {error}\n")
        return 1
    _write_json_line(scan_request(request))
    return 0
