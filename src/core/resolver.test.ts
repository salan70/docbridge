import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { CodeScanResult } from "./code-scanner";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
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

type DocAnchorOptions = {
  filePath?: string;
  level?: number;
  hasCodeAnnotation?: boolean;
  line?: number;
};

function docAnchor(anchor: string, options: DocAnchorOptions = {}): DocAnchorEndpoint {
  const filePath = options.filePath ?? DOC_FILE;
  return {
    kind: "doc",
    filePath,
    anchor,
    endpoint: `${filePath}#${anchor}`,
    headingText: anchor,
    level: options.level ?? 1,
    hasCodeAnnotation: options.hasCodeAnnotation ?? false,
    location: { filePath, line: options.line ?? 1, column: 1 },
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
      docFiles: [
        docFile(
          DOC_FILE,
          [docAnchor("login-spec", { hasCodeAnnotation: true })],
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
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
        docFile(
          DOC_FILE,
          [docAnchor("login-spec", { hasCodeAnnotation: true })],
          [codeLink(docEndpoint, codeEndpoint)],
        ),
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
        docFile(
          DOC_FILE,
          [docAnchor("login-spec", { hasCodeAnnotation: true })],
          [codeLink(docEndpoint, codeEndpoint)],
        ),
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
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
        docFile(
          DOC_FILE,
          [docAnchor("login-spec", { hasCodeAnnotation: true })],
          [codeLink(docEndpoint, codeEndpoint)],
        ),
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
      docFiles: [docFile(DOC_FILE, [], [codeLink(docEndpoint, codeEndpoint)])],
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
      codeFiles: [codeFile(CODE_FILE, [codeSymbol("login")], [docLink(codeEndpoint, docEndpoint)])],
      docFiles: [
        docFile(
          DOC_FILE,
          [docAnchor("login-spec", { hasCodeAnnotation: true })],
          [codeLink(docEndpoint, codeEndpoint)],
        ),
      ],
      scanDiagnostics: [],
      audit: true,
    });

    expect(codes(diagnostics)).not.toContain("undocumented_symbol");
  });

  // --- unlinked_doc_section ------------------------------------------------

  function unlinkedDocSectionAudit(anchors: DocAnchorEndpoint[]): DocBridgeDiagnostic[] {
    return resolveLinks({
      codeFiles: [],
      docFiles: [docFile(DOC_FILE, anchors, [])],
      scanDiagnostics: [],
      audit: true,
    }).filter((diagnostic) => diagnostic.code === "unlinked_doc_section");
  }

  test("does not emit unlinked_doc_section when audit is disabled", () => {
    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [docFile(DOC_FILE, [docAnchor("plain")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(codes(diagnostics)).not.toContain("unlinked_doc_section");
  });

  test("emits unlinked_doc_section for a heading with no @code annotation", () => {
    const diagnostics = unlinkedDocSectionAudit([docAnchor("plain", { level: 1, line: 4 })]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.target).toBe(`${DOC_FILE}#plain`);
    expect(diagnostics[0]?.source).toBeUndefined();
    expect(diagnostics[0]?.location).toEqual({ filePath: DOC_FILE, line: 4, column: 1 });
  });

  test("does not emit unlinked_doc_section for an annotated heading", () => {
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("linked", { level: 1, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics).toEqual([]);
  });

  test("suppresses an unannotated heading whose descendant is annotated", () => {
    // # Top (no @code) > ## Linked (@code). The subtree carries a link, so the
    // parent is not reported and neither is the annotated child.
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1 }),
      docAnchor("linked", { level: 2, line: 2, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics).toEqual([]);
  });

  test("reports only the topmost heading when a whole subtree is unannotated", () => {
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1 }),
      docAnchor("child", { level: 2, line: 2 }),
      docAnchor("grandchild", { level: 3, line: 3 }),
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.target).toBe(`${DOC_FILE}#top`);
  });

  test("reports the suppressed descendant count in the message", () => {
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1 }),
      docAnchor("child", { level: 2, line: 2 }),
      docAnchor("grandchild", { level: 3, line: 3 }),
    ]);

    expect(diagnostics[0]?.message).toBe(
      `Doc section ${DOC_FILE}#top has no @code annotation (2 descendant headings suppressed).`,
    );
  });

  test("uses the singular noun for a single suppressed descendant", () => {
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1 }),
      docAnchor("child", { level: 2, line: 2 }),
    ]);

    expect(diagnostics[0]?.message).toBe(
      `Doc section ${DOC_FILE}#top has no @code annotation (1 descendant heading suppressed).`,
    );
  });

  test("omits the descendant count when the reported heading has no descendants", () => {
    const diagnostics = unlinkedDocSectionAudit([docAnchor("plain", { level: 1, line: 1 })]);

    expect(diagnostics[0]?.message).toBe(`Doc section ${DOC_FILE}#plain has no @code annotation.`);
  });

  test("descends past an annotated heading to report its unannotated children", () => {
    // # Top (@code) > ## A (no @code), ## B (@code). Only A is reported.
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1, hasCodeAnnotation: true }),
      docAnchor("a", { level: 2, line: 2 }),
      docAnchor("b", { level: 2, line: 3, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#a`]);
  });

  test("treats a skipped heading level as a direct descendant", () => {
    // # Top, ### Deep, ## Middle. `Middle` closes `Deep`, so both are children
    // of `Top`; the annotation on `Middle` covers the whole `Top` subtree.
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("top", { level: 1, line: 1 }),
      docAnchor("deep", { level: 3, line: 2 }),
      docAnchor("middle", { level: 2, line: 3, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#deep`]);
  });

  test("treats sibling top-level headings as independent roots", () => {
    const diagnostics = unlinkedDocSectionAudit([
      docAnchor("first", { level: 1, line: 1, hasCodeAnnotation: true }),
      docAnchor("second", { level: 1, line: 2 }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#second`]);
  });

  test("suppresses unlinked_doc_section for doc files with a read error", () => {
    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [docFile(DOC_FILE, [docAnchor("plain")], [])],
      scanDiagnostics: [
        {
          severity: "error",
          code: "file_read_error",
          target: DOC_FILE,
          message: "Failed to read file.",
        },
      ],
      audit: true,
    });

    expect(codes(diagnostics)).not.toContain("unlinked_doc_section");
  });

  test("treats a heading with an unparsable @code target as linked", () => {
    // `src/auth/login.ts` has no `#fragment`, so scanning emits
    // invalid_link_target and produces no link. The heading still counts as an
    // attempted link, so the audit must stay silent about it.
    const scan = scanMarkdown(
      DOC_FILE,
      ["<!-- @code src/auth/login.ts -->", "# Broken"].join("\n"),
    );

    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [scan],
      scanDiagnostics: scan.diagnostics,
      audit: true,
    });

    expect(codes(diagnostics)).not.toContain("unlinked_doc_section");
  });

  test("sets the diagnostic range to the heading text", () => {
    const scan = scanMarkdown(DOC_FILE, "## Plain Section\n");

    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [scan],
      scanDiagnostics: [],
      audit: true,
    });

    // `## ` is 3 characters, so the heading text starts at column 4.
    expect(diagnostics[0]?.range).toEqual({
      start: { line: 1, column: 4 },
      end: { line: 1, column: 4 + "Plain Section".length },
    });
  });

  test("reports the children of an empty heading, which carries no anchor", () => {
    // An empty heading produces no anchor, so it is invisible to the tree and
    // its unannotated child becomes the reported root.
    const scan = scanMarkdown(DOC_FILE, ["#", "## Child"].join("\n"));

    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [scan],
      scanDiagnostics: scan.diagnostics,
      audit: true,
    }).filter((diagnostic) => diagnostic.code === "unlinked_doc_section");

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#child`]);
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
