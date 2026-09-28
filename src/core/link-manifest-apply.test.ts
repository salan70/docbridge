import { expect, test } from "bun:test";

import type { CodeScanResult } from "./code-scanner";
import { LINK_MANIFEST_FILE_NAME, resolveLinkManifest, type LinkManifest } from "./link-manifest";
import { applyLinkManifest } from "./link-manifest-apply";
import type { MarkdownScanResult } from "./markdown";
import type {
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  DocHeadingOutline,
  LinkAnnotation,
  DocBridgeDiagnostic,
} from "./types";

const CODE_FILE = "src/auth.ts";
const DOC_FILE = "docs/auth.md";
const CODE_ENDPOINT = `${CODE_FILE}#AuthService.login`;
const DOC_ENDPOINT = `${DOC_FILE}#login-flow`;

function manifestOf(
  links: { code: string; doc: string }[] = [{ code: CODE_ENDPOINT, doc: DOC_ENDPOINT }],
): LinkManifest {
  const result = resolveLinkManifest(JSON.stringify({ links }, null, 2));
  if (!result.ok) {
    throw new Error(`invalid test manifest: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.manifest;
}

function codeSymbol(canonicalId: string, filePath = CODE_FILE): CodeSymbolEndpoint {
  return {
    kind: "code",
    language: "typescript",
    filePath,
    symbolName: canonicalId,
    canonicalId,
    endpoint: `${filePath}#${canonicalId}`,
    location: { filePath, line: 1, column: 1 },
  };
}

function codeFile(
  symbols: CodeSymbolEndpoint[],
  undocumentedSymbols: CodeSymbolEndpoint[] = [],
  links: LinkAnnotation[] = [],
  filePath = CODE_FILE,
): CodeScanResult {
  return { language: "typescript", filePath, symbols, undocumentedSymbols, links, diagnostics: [] };
}

function docAnchor(anchor: string, filePath = DOC_FILE): DocAnchorEndpoint {
  return {
    kind: "doc",
    filePath,
    anchor,
    endpoint: `${filePath}#${anchor}`,
    headingText: anchor,
    location: { filePath, line: 1, column: 1 },
  };
}

function docFile(
  anchors: DocAnchorEndpoint[],
  links: LinkAnnotation[] = [],
  filePath = DOC_FILE,
): MarkdownScanResult {
  const headings: DocHeadingOutline[] = anchors.map((anchor) => ({
    level: 2,
    hasCodeAnnotation: false,
    anchor,
  }));
  return { filePath, anchors, headings, links, diagnostics: [] };
}

type ApplyOptions = {
  manifest?: LinkManifest;
  codeFiles?: CodeScanResult[];
  docFiles?: MarkdownScanResult[];
  scanDiagnostics?: DocBridgeDiagnostic[];
};

function apply(options: ApplyOptions = {}) {
  return applyLinkManifest({
    manifest: options.manifest ?? manifestOf(),
    codeFiles: options.codeFiles ?? [codeFile([], [codeSymbol("AuthService.login")])],
    docFiles: options.docFiles ?? [docFile([docAnchor("login-flow")])],
    scanDiagnostics: options.scanDiagnostics ?? [],
  });
}

test("applyLinkManifest moves a linked symbol into the documented set", () => {
  const result = apply();

  expect(result.codeFiles[0]?.symbols.map((symbol) => symbol.endpoint)).toEqual([CODE_ENDPOINT]);
  expect(result.codeFiles[0]?.undocumentedSymbols).toEqual([]);
});

test("applyLinkManifest marks the linked heading as annotated", () => {
  const result = apply();

  expect(result.docFiles[0]?.headings[0]?.hasCodeAnnotation).toBe(true);
});

test("applyLinkManifest keeps a symbol that is already documented", () => {
  const result = apply({ codeFiles: [codeFile([codeSymbol("AuthService.login")])] });

  expect(result.diagnostics).toEqual([]);
  expect(result.codeFiles[0]?.symbols).toHaveLength(1);
});

test("applyLinkManifest reports code_file_not_found at the code value", () => {
  const result = apply({ codeFiles: [codeFile([], [], [], "src/other.ts")] });

  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  expect(diagnostic?.code).toBe("code_file_not_found");
  expect(diagnostic?.severity).toBe("error");
  expect(diagnostic?.target).toBe(CODE_ENDPOINT);
  expect(diagnostic?.location?.filePath).toBe(LINK_MANIFEST_FILE_NAME);
  // The entry object opens on line 3; the diagnostic points at the `code` value.
  expect(diagnostic?.location?.line).toBe(4);
});

test("applyLinkManifest reports code_symbol_not_found with a suggestion", () => {
  const result = apply({
    codeFiles: [codeFile([], [codeSymbol("AuthService.loginUser")])],
  });

  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  expect(diagnostic?.code).toBe("code_symbol_not_found");
  expect(diagnostic?.severity).toBe("error");
  expect(diagnostic?.target).toBe(CODE_ENDPOINT);
  expect(diagnostic?.language).toBe("typescript");
  expect(diagnostic?.message).toContain("Did you mean `AuthService.loginUser`?");
});

test("applyLinkManifest omits the suggestion when no symbol is close", () => {
  const result = apply({ codeFiles: [codeFile([], [codeSymbol("unrelated")])] });

  expect(result.diagnostics[0]?.code).toBe("code_symbol_not_found");
  expect(result.diagnostics[0]?.message).not.toContain("Did you mean");
});

test("applyLinkManifest reports doc_file_not_found and still documents the symbol", () => {
  const result = apply({
    docFiles: [docFile([docAnchor("other", "docs/other.md")], [], "docs/other.md")],
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_file_not_found"]);
  expect(result.diagnostics[0]?.target).toBe(DOC_ENDPOINT);
  expect(result.codeFiles[0]?.undocumentedSymbols).toEqual([]);
});

test("applyLinkManifest reports doc_anchor_not_found and still marks nothing annotated", () => {
  const result = apply({ docFiles: [docFile([docAnchor("other-section")])] });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_anchor_not_found"]);
  expect(result.docFiles[0]?.headings[0]?.hasCodeAnnotation).toBe(false);
});

test("applyLinkManifest marks the heading annotated when only the code side fails", () => {
  const result = apply({ codeFiles: [codeFile([], [codeSymbol("unrelated")])] });

  expect(result.docFiles[0]?.headings[0]?.hasCodeAnnotation).toBe(true);
});

test("applyLinkManifest adds no link when either end fails", () => {
  const result = apply({ docFiles: [docFile([docAnchor("other-section")])] });

  expect(result.codeFiles[0]?.links).toEqual([]);
  expect(result.docFiles[0]?.links).toEqual([]);
});

test("applyLinkManifest reports duplicate_link against an existing annotation pair", () => {
  const annotation: LinkAnnotation = {
    source: CODE_ENDPOINT,
    target: DOC_ENDPOINT,
    location: { filePath: CODE_FILE, line: 2, column: 1 },
  };
  const backlink: LinkAnnotation = {
    source: DOC_ENDPOINT,
    target: CODE_ENDPOINT,
    location: { filePath: DOC_FILE, line: 3, column: 1 },
  };

  const result = apply({
    codeFiles: [codeFile([codeSymbol("AuthService.login")], [], [annotation])],
    docFiles: [docFile([docAnchor("login-flow")], [backlink])],
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate_link"]);
  expect(result.diagnostics[0]?.severity).toBe("warning");
  expect(result.codeFiles[0]?.links).toHaveLength(1);
  expect(result.docFiles[0]?.links).toHaveLength(1);
});

test("applyLinkManifest adds only the missing direction of a one-way annotation", () => {
  const annotation: LinkAnnotation = {
    source: CODE_ENDPOINT,
    target: DOC_ENDPOINT,
    location: { filePath: CODE_FILE, line: 2, column: 1 },
  };

  const result = apply({
    codeFiles: [codeFile([codeSymbol("AuthService.login")], [], [annotation])],
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate_link"]);
  expect(result.codeFiles[0]?.links).toHaveLength(1);
  expect(result.docFiles[0]?.links).toHaveLength(1);
});

test("applyLinkManifest reports duplicate_link for a repeated entry", () => {
  const manifest = manifestOf([
    { code: CODE_ENDPOINT, doc: DOC_ENDPOINT },
    { code: CODE_ENDPOINT, doc: DOC_ENDPOINT },
  ]);

  const result = apply({ manifest });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate_link"]);
  expect(result.codeFiles[0]?.links).toHaveLength(1);
});

test("applyLinkManifest skips an entry whose code file failed to scan", () => {
  const result = apply({
    scanDiagnostics: [
      {
        severity: "error",
        code: "code_parse_error",
        target: CODE_FILE,
        message: "parse error",
      },
    ],
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.docFiles[0]?.links).toEqual([]);
});

test("applyLinkManifest skips an entry whose doc file failed to read", () => {
  const result = apply({
    scanDiagnostics: [
      {
        severity: "error",
        code: "file_read_error",
        target: DOC_FILE,
        message: "read error",
      },
    ],
  });

  expect(result.diagnostics).toEqual([]);
  expect(result.codeFiles[0]?.links).toEqual([]);
});

test("applyLinkManifest does not mutate its inputs", () => {
  const codeFiles = [codeFile([], [codeSymbol("AuthService.login")])];
  const docFiles = [docFile([docAnchor("login-flow")])];
  const before = structuredClone({ codeFiles, docFiles });

  applyLinkManifest({ manifest: manifestOf(), codeFiles, docFiles, scanDiagnostics: [] });

  expect({ codeFiles, docFiles }).toEqual(before);
});

test("applyLinkManifest returns the inputs unchanged for an empty manifest", () => {
  const codeFiles = [codeFile([], [codeSymbol("AuthService.login")])];
  const docFiles = [docFile([docAnchor("login-flow")])];

  const result = applyLinkManifest({
    manifest: { entries: [] },
    codeFiles,
    docFiles,
    scanDiagnostics: [],
  });

  expect(result.codeFiles).toBe(codeFiles);
  expect(result.docFiles).toBe(docFiles);
  expect(result.diagnostics).toEqual([]);
});
