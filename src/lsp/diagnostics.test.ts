import { describe, expect, test } from "bun:test";

import type { DocBridgeDiagnostic } from "../core/types";
import { diagnosticsForFile, toLspDiagnostic } from "./diagnostics";
import { CODE_FILE, stateOf } from "./fixtures";

describe(diagnosticsForFile, () => {
  test("maps a link-target diagnostic with severity, code, and target range", () => {
    const code = "/**\n * @doc bad-target\n */\nexport function login() {}\n";
    const state = stateOf(code, "## Other\n");

    const mapped = diagnosticsForFile(state.diagnostics, CODE_FILE, code);
    const invalid = mapped.find((d) => d.code === "invalid_link_target");

    expect(invalid?.severity).toBe(1);
    expect(invalid?.source).toBe("docbridge");
    // `bad-target` begins at column 9 (0-based char 8) on line 2 (0-based 1).
    expect(invalid?.range).toEqual({
      start: { line: 1, character: 8 },
      end: { line: 1, character: 8 + "bad-target".length },
    });
  });

  test("maps a warning to severity 2 and falls back to the whole line", () => {
    const diagnostic: DocBridgeDiagnostic = {
      severity: "warning",
      code: "unsupported_declaration",
      target: CODE_FILE,
      message: "unsupported",
      location: { filePath: CODE_FILE, line: 1, column: 1 },
    };

    const mapped = toLspDiagnostic(diagnostic, ["export namespace N {}".length]);

    expect(mapped.severity).toBe(2);
    expect(mapped.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: "export namespace N {}".length },
    });
  });

  test("only returns diagnostics whose location is in the requested file", () => {
    const code = "/**\n * @doc bad-target\n */\nexport function login() {}\n";
    const state = stateOf(code, "## Other\n");

    expect(diagnosticsForFile(state.diagnostics, "docs/auth.md", "## Other\n")).toEqual([]);
  });
});
