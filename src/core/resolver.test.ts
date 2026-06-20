import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { CodeScanResult } from "./code-scanner";
import type { MarkdownScanResult } from "./markdown";
import { check, resolveLinks } from "./resolver";
import type {
  CodeLinkAnnotation,
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  DocLinkAnnotation,
  SourceLocation,
  DocBridgeDiagnostic,
} from "./types";

const CODE_FILE = "src/auth/login.ts";
const DOC_FILE = "docs/auth.md";

function loc(filePath: string): SourceLocation {
  return { filePath, line: 1, column: 1 };
}

function codeSymbol(symbolName: string, filePath = CODE_FILE): CodeSymbolEndpoint {
  return {
    kind: "code",
    language: "typescript",
    filePath,
    symbolName,
    canonicalId: symbolName,
    endpoint: `${filePath}#${symbolName}`,
    location: loc(filePath),
  };
}

function docAnchor(anchor: string, filePath = DOC_FILE): DocAnchorEndpoint {
  return {
    kind: "doc",
    filePath,
    anchor,
    endpoint: `${filePath}#${anchor}`,
    headingText: anchor,
    location: loc(filePath),
  };
}

function docLink(source: string, target: string, filePath = CODE_FILE): DocLinkAnnotation {
  return {
    direction: "code-to-doc",
    source,
    target,
    location: loc(filePath),
  };
}

function codeLink(source: string, target: string, filePath = DOC_FILE): CodeLinkAnnotation {
  return {
    direction: "doc-to-code",
    source,
    target,
    location: loc(filePath),
  };
}

function codeFile(
  filePath: string,
  symbols: CodeSymbolEndpoint[],
  links: DocLinkAnnotation[],
  diagnostics: DocBridgeDiagnostic[] = [],
  undocumentedSymbols: CodeSymbolEndpoint[] = [],
): CodeScanResult {
  return { language: "typescript", filePath, symbols, undocumentedSymbols, links, diagnostics };
}

function docFile(
  filePath: string,
  anchors: DocAnchorEndpoint[],
  links: CodeLinkAnnotation[],
  diagnostics: DocBridgeDiagnostic[] = [],
): MarkdownScanResult {
  return { filePath, anchors, links, diagnostics };
}

function codes(diagnostics: DocBridgeDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe(resolveLinks, () => {
  test("valid bidirectional pair produces no relationship diagnostics", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = `${DOC_FILE}#login-spec`;

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(
          CODE_FILE,
          [codeSymbol("login")],
          [docLink(codeEndpoint, docEndpoint)],
        ),
      ],
      docFiles: [
        docFile(
          DOC_FILE,
          [docAnchor("login-spec")],
          [codeLink(docEndpoint, codeEndpoint)],
        ),
      ],
      scanDiagnostics: [],
      audit: false,
    });

    expect(diagnostics).toEqual([]);
  });

  test("emits doc_file_not_found when the target doc file is unmanaged", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = "docs/missing.md#login-spec";

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)]),
      ],
      docFiles: [],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).toEqual(["doc_file_not_found"]);
    expect(diagnostics[0]?.source).toBe(codeEndpoint);
    expect(diagnostics[0]?.target).toBe(docEndpoint);
  });

  test("emits doc_anchor_not_found when the file exists but the anchor does not", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = `${DOC_FILE}#missing`;

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)]),
      ],
      docFiles: [docFile(DOC_FILE, [docAnchor("login-spec")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).toEqual(["doc_anchor_not_found"]);
  });

  test("emits doc_backlink_not_found when the anchor exists but no @code points back", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = `${DOC_FILE}#login-spec`;

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)]),
      ],
      docFiles: [docFile(DOC_FILE, [docAnchor("login-spec")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).toEqual(["doc_backlink_not_found"]);
  });

  test("emits code_file_not_found when the target code file is unmanaged", () => {
    const docEndpoint = `${DOC_FILE}#login-spec`;
    const codeEndpoint = "src/missing.ts#login";

    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [
        docFile(DOC_FILE, [docAnchor("login-spec")], [codeLink(docEndpoint, codeEndpoint)]),
      ],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).toEqual(["code_file_not_found"]);
    expect(diagnostics[0]?.source).toBe(docEndpoint);
    expect(diagnostics[0]?.target).toBe(codeEndpoint);
  });

  test("emits code_backlink_not_found when the code file exists but the @doc pair is missing", () => {
    const docEndpoint = `${DOC_FILE}#login-spec`;
    const codeEndpoint = `${CODE_FILE}#login`;

    const diagnostics = resolveLinks({
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [])],
      docFiles: [
        docFile(DOC_FILE, [docAnchor("login-spec")], [codeLink(docEndpoint, codeEndpoint)]),
      ],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).toEqual(["code_backlink_not_found"]);
  });

  test("suppresses doc-side diagnostics when the target doc file had a read error", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = `${DOC_FILE}#login-spec`;

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)]),
      ],
      docFiles: [],
      scanDiagnostics: [
        {
          severity: "error",
          code: "file_read_error",
          target: DOC_FILE,
          message: "Failed to read file.",
        },
      ],
      audit: false,
    });

    // Without suppression this would be doc_file_not_found.
    expect(diagnostics).toEqual([]);
  });

  test("suppresses code-side diagnostics when the target code file had a parse error", () => {
    const docEndpoint = `${DOC_FILE}#login-spec`;
    const codeEndpoint = `${CODE_FILE}#login`;

    const diagnostics = resolveLinks({
      // The errored code file is still in the managed set but exposes no symbols.
      codeFiles: [codeFile(CODE_FILE, [], [])],
      docFiles: [
        docFile(DOC_FILE, [docAnchor("login-spec")], [codeLink(docEndpoint, codeEndpoint)]),
      ],
      scanDiagnostics: [
        {
          severity: "error",
          code: "code_parse_error",
          target: CODE_FILE,
          message: "Parse error.",
          location: loc(CODE_FILE),
        },
      ],
      audit: false,
    });

    // Without suppression this would be code_backlink_not_found.
    expect(diagnostics).toEqual([]);
  });

  test("suppresses doc->code diagnostics originating from a doc file with a read error", () => {
    // The doc file is errored, so any @code link it (would have) carried is
    // derived from that file and must be suppressed even if it somehow surfaced.
    const docEndpoint = `${DOC_FILE}#login-spec`;
    const codeEndpoint = "src/missing.ts#login";

    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [
        docFile(DOC_FILE, [], [codeLink(docEndpoint, codeEndpoint)]),
      ],
      scanDiagnostics: [
        {
          severity: "error",
          code: "file_read_error",
          target: DOC_FILE,
          message: "Failed to read file.",
        },
      ],
      audit: false,
    });

    expect(diagnostics).toEqual([]);
  });

  test("does not emit undocumented_symbol when audit is disabled", () => {
    const diagnostics = resolveLinks({
      codeFiles: [codeFile(CODE_FILE, [], [], [], [codeSymbol("login")])],
      docFiles: [],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).not.toContain("undocumented_symbol");
  });

  test("emits undocumented_symbol for an undocumented endpoint under audit", () => {
    const diagnostics = resolveLinks({
      codeFiles: [codeFile(CODE_FILE, [], [], [], [codeSymbol("login")])],
      docFiles: [],
      scanDiagnostics: [],
      audit: true,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("undocumented_symbol");
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.target).toBe(`${CODE_FILE}#login`);
  });

  test("suppresses undocumented_symbol for errored code files under audit", () => {
    const diagnostics = resolveLinks({
      codeFiles: [codeFile(CODE_FILE, [], [], [], [codeSymbol("login")])],
      docFiles: [],
      scanDiagnostics: [
        {
          severity: "error",
          code: "code_parse_error",
          target: CODE_FILE,
          message: "parse error",
          location: loc(CODE_FILE),
        },
      ],
      audit: true,
    });

    expect(codes(diagnostics)).not.toContain("undocumented_symbol");
  });

  test("documented endpoints never produce undocumented_symbol under audit", () => {
    const codeEndpoint = `${CODE_FILE}#login`;
    const docEndpoint = `${DOC_FILE}#login-spec`;

    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)]),
      ],
      docFiles: [
        docFile(DOC_FILE, [docAnchor("login-spec")], [codeLink(docEndpoint, codeEndpoint)]),
      ],
      scanDiagnostics: [],
      audit: true,
    });

    expect(codes(diagnostics)).not.toContain("undocumented_symbol");
  });
});

describe(check, () => {
  test("examples/typescript resolves to zero diagnostics", () => {
    const projectRoot = join(import.meta.dir, "..", "..", "examples", "typescript");
    const result = check({ projectRoot });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ errors: 0, warnings: 0 });
  });

  test("examples/typescript with audit also resolves to zero diagnostics", () => {
    const projectRoot = join(import.meta.dir, "..", "..", "examples", "typescript");
    const result = check({ projectRoot, audit: true });

    expect(result.diagnostics).toEqual([]);
  });
});
