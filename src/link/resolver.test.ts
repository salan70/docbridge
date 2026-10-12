import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import type { CodeScanResult } from "../model/scan-result";
import type { MarkdownScanResult } from "../model/scan-result";
import type {
  CodeSymbolEndpoint,
  DocAnchorEndpoint,
  DocHeadingOutline,
  LinkAnnotation,
  SourceLocation,
  DocBridgeDiagnostic,
} from "../model/types";
import { check } from "../query/check";
import { scanMarkdown } from "../scan/markdown/markdown";
import { codes, makeProject } from "../test-support";
import { resolveLinks } from "./resolver";

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
    location: { filePath, line: options.line ?? 1, column: 1 },
  };
}

type DocHeadingOptions = DocAnchorOptions & {
  level?: number;
  hasCodeAnnotation?: boolean;
};

/** An outline entry for a heading that creates an anchor. */
function docHeading(anchor: string, options: DocHeadingOptions = {}): DocHeadingOutline {
  return {
    level: options.level ?? 1,
    hasCodeAnnotation: options.hasCodeAnnotation ?? false,
    anchor: docAnchor(anchor, options),
  };
}

/** An outline entry for an empty heading, which creates no anchor. */
function emptyHeading(level: number): DocHeadingOutline {
  return { level, hasCodeAnnotation: false };
}

function docLink(source: string, target: string, filePath = CODE_FILE): LinkAnnotation {
  return {
    source,
    target,
    location: loc(filePath),
  };
}

function codeLink(source: string, target: string, filePath = DOC_FILE): LinkAnnotation {
  return {
    source,
    target,
    location: loc(filePath),
  };
}

function codeFile(
  filePath: string,
  symbols: CodeSymbolEndpoint[],
  links: LinkAnnotation[],
  diagnostics: DocBridgeDiagnostic[] = [],
  undocumentedSymbols: CodeSymbolEndpoint[] = [],
): CodeScanResult {
  return { language: "typescript", filePath, symbols, undocumentedSymbols, links, diagnostics };
}

function docFile(
  filePath: string,
  anchors: DocAnchorEndpoint[],
  links: LinkAnnotation[],
  diagnostics: DocBridgeDiagnostic[] = [],
): MarkdownScanResult {
  // Link resolution reads `anchors`; only the audit rule reads `headings`, and
  // the tests that exercise it build the outline explicitly instead.
  return { filePath, anchors, headings: [], links, diagnostics };
}

function docFileWithHeadings(filePath: string, headings: DocHeadingOutline[]): MarkdownScanResult {
  const anchors = headings
    .map((heading) => heading.anchor)
    .filter((anchor): anchor is DocAnchorEndpoint => anchor !== undefined);
  return { filePath, anchors, headings, links: [], diagnostics: [] };
}

describe(resolveLinks, () => {
  test("suppresses doc-side diagnostics when the target doc file had a read error", async () => {
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

  test("suppresses code-side diagnostics when the target code file had a parse error", async () => {
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

  test("suppresses doc->code diagnostics originating from a doc file with a read error", async () => {
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

  test("suppresses undocumented_symbol for errored code files under audit", async () => {
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

  // --- unlinked_doc_section ------------------------------------------------

  function unlinkedDocSectionAudit(headings: DocHeadingOutline[]): DocBridgeDiagnostic[] {
    return resolveLinks({
      codeFiles: [],
      docFiles: [docFileWithHeadings(DOC_FILE, headings)],
      scanDiagnostics: [],
      audit: true,
    }).filter((diagnostic) => diagnostic.code === "unlinked_doc_section");
  }

  test("reports only the topmost heading when a whole subtree is unannotated", async () => {
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1 }),
      docHeading("child", { level: 2, line: 2 }),
      docHeading("grandchild", { level: 3, line: 3 }),
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.target).toBe(`${DOC_FILE}#top`);
  });

  test("reports the suppressed descendant count in the message", async () => {
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1 }),
      docHeading("child", { level: 2, line: 2 }),
      docHeading("grandchild", { level: 3, line: 3 }),
    ]);

    expect(diagnostics[0]?.message).toBe(
      `Doc section ${DOC_FILE}#top has no @code annotation (2 descendant headings suppressed).`,
    );
  });

  test("uses the singular noun for a single suppressed descendant", async () => {
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1 }),
      docHeading("child", { level: 2, line: 2 }),
    ]);

    expect(diagnostics[0]?.message).toBe(
      `Doc section ${DOC_FILE}#top has no @code annotation (1 descendant heading suppressed).`,
    );
  });

  test("omits the descendant count when the reported heading has no descendants", async () => {
    const diagnostics = unlinkedDocSectionAudit([docHeading("plain", { level: 1, line: 1 })]);

    expect(diagnostics[0]?.message).toBe(`Doc section ${DOC_FILE}#plain has no @code annotation.`);
  });

  test("descends past an annotated heading to report its unannotated children", async () => {
    // # Top (@code) > ## A (no @code), ## B (@code). Only A is reported.
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1, hasCodeAnnotation: true }),
      docHeading("a", { level: 2, line: 2 }),
      docHeading("b", { level: 2, line: 3, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#a`]);
  });

  test("treats a skipped heading level as a direct descendant", async () => {
    // # Top, ### Deep, ## Middle. `Middle` closes `Deep`, so both are children
    // of `Top`; the annotation on `Middle` covers the whole `Top` subtree.
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1 }),
      docHeading("deep", { level: 3, line: 2 }),
      docHeading("middle", { level: 2, line: 3, hasCodeAnnotation: true }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#deep`]);
  });

  test("treats sibling top-level headings as independent roots", async () => {
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("first", { level: 1, line: 1, hasCodeAnnotation: true }),
      docHeading("second", { level: 1, line: 2 }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#second`]);
  });

  test("suppresses unlinked_doc_section for doc files with a read error", async () => {
    const diagnostics = resolveLinks({
      codeFiles: [],
      docFiles: [docFileWithHeadings(DOC_FILE, [docHeading("plain")])],
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

  test("treats a heading with an unparsable @code target as linked", async () => {
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

  test("sets the diagnostic range to the heading text", async () => {
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

  test("counts an empty heading among the suppressed descendants", async () => {
    // The empty heading is part of the unbridged region even though it can
    // never be reported on its own.
    const diagnostics = unlinkedDocSectionAudit([
      docHeading("top", { level: 1, line: 1 }),
      emptyHeading(2),
      docHeading("deep", { level: 3, line: 3 }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#top`]);
    expect(diagnostics[0]?.message).toBe(
      `Doc section ${DOC_FILE}#top has no @code annotation (2 descendant headings suppressed).`,
    );
  });

  function unlinkedDocSectionScan(content: string): DocBridgeDiagnostic[] {
    const scan = scanMarkdown(DOC_FILE, content);

    return resolveLinks({
      codeFiles: [],
      docFiles: [scan],
      scanDiagnostics: scan.diagnostics,
      audit: true,
    }).filter((diagnostic) => diagnostic.code === "unlinked_doc_section");
  }

  test("reports the children of an empty heading, which is never reportable itself", async () => {
    // An empty heading creates no anchor, so it cannot be reported. Reporting
    // descends through it to its children instead.
    const diagnostics = unlinkedDocSectionScan(["#", "## Child"].join("\n"));

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#child`]);
  });

  test("lets an empty heading close the section of a deeper preceding heading", async () => {
    // `extractDocSection` ends `### Parent` at the empty `##`, so `#### Child`
    // is not inside Parent's section. The audit must agree and report the two
    // as independent unlinked regions rather than rolling Child up into Parent.
    const diagnostics = unlinkedDocSectionScan(["### Parent", "##", "#### Child"].join("\n"));

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([
      `${DOC_FILE}#parent`,
      `${DOC_FILE}#child`,
    ]);
    expect(diagnostics[0]?.message).toBe(`Doc section ${DOC_FILE}#parent has no @code annotation.`);
  });

  test("an annotation below an empty heading does not cover a deeper heading above it", async () => {
    // The empty `##` closes `### Parent`, so the annotation on `#### Child`
    // belongs to a sibling region and cannot suppress Parent.
    const diagnostics = unlinkedDocSectionScan(
      ["### Parent", "##", "<!-- @code src/example.ts#example -->", "#### Child"].join("\n"),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.target)).toEqual([`${DOC_FILE}#parent`]);
  });

  test("doc_anchor_not_found suggests the nearest anchor in the same doc file", () => {
    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(
          CODE_FILE,
          [codeSymbol("login")],
          [docLink(`${CODE_FILE}#login`, `${DOC_FILE}#login-spek`)],
        ),
      ],
      docFiles: [docFile(DOC_FILE, [docAnchor("login-spec"), docAnchor("logout")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_anchor_not_found"]);
    expect(diagnostics[0]?.message).toContain("Did you mean `docs/auth.md#login-spec`?");
  });

  test("doc_anchor_not_found suggests a non-ASCII heading anchor", () => {
    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(
          CODE_FILE,
          [codeSymbol("login")],
          [docLink(`${CODE_FILE}#login`, `${DOC_FILE}#画面の移動-go_router`)],
        ),
      ],
      docFiles: [docFile(DOC_FILE, [docAnchor("画面の移動-go-router")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_anchor_not_found"]);
    expect(diagnostics[0]?.message).toContain("Did you mean `docs/auth.md#画面の移動-go-router`?");
  });

  test("doc_anchor_not_found omits the suggestion when no anchor is close", () => {
    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(
          CODE_FILE,
          [codeSymbol("login")],
          [docLink(`${CODE_FILE}#login`, `${DOC_FILE}#login-spek`)],
        ),
      ],
      docFiles: [docFile(DOC_FILE, [docAnchor("other-section")], [])],
      scanDiagnostics: [],
      audit: false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_anchor_not_found"]);
    expect(diagnostics[0]?.message).not.toContain("Did you mean");
  });

  test("doc_anchor_not_found does not suggest an anchor from another doc file", () => {
    const otherDocFile = "docs/login.md";
    const diagnostics = resolveLinks({
      codeFiles: [
        codeFile(
          CODE_FILE,
          [codeSymbol("login")],
          [docLink(`${CODE_FILE}#login`, `${DOC_FILE}#login-spek`)],
        ),
      ],
      docFiles: [
        docFile(DOC_FILE, [docAnchor("other-section")], []),
        docFile(otherDocFile, [docAnchor("login-spec", { filePath: otherDocFile })], []),
      ],
      scanDiagnostics: [],
      audit: false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["doc_anchor_not_found"]);
    expect(diagnostics[0]?.message).not.toContain("Did you mean");
  });
});

describe(check, () => {
  test("examples/typescript with audit also resolves to zero diagnostics", async () => {
    const projectRoot = join(import.meta.dir, "..", "..", "examples", "typescript");
    const result = await check({ projectRoot, audit: true });

    expect(result.diagnostics).toEqual([]);
  });

  test("audit reports neither audit code for a manifest-linked pair", async () => {
    const root = manifestProject();

    try {
      expect((await check({ projectRoot: root, audit: true })).diagnostics).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a manifest entry naming a missing symbol reports code_symbol_not_found", async () => {
    const root = manifestProject({ symbolName: "logIn" });

    try {
      const result = await check({ projectRoot: root });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("code_symbol_not_found");
      expect(result.diagnostics[0]?.message).toContain("Did you mean `logIn`?");
      expect(result.diagnostics[0]?.location?.filePath).toBe("docbridge.links.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a manifest entry duplicating an annotation pair reports duplicate_link", async () => {
    const root = manifestProject({ annotate: true });

    try {
      const result = await check({ projectRoot: root });

      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate_link"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

type ManifestProjectOptions = {
  /** The declaration the source actually exports; defaults to the linked name. */
  symbolName?: string;
  /** Whether the source and document also carry the annotation pair. */
  annotate?: boolean;
};

function manifestProject(options: ManifestProjectOptions = {}): string {
  const symbolName = options.symbolName ?? "login";
  const docTag = options.annotate ? "/** @doc docs/auth.md#login-spec */\n" : "";
  const codeTag = options.annotate ? "<!-- @code src/login.ts#login -->\n" : "";

  return makeProject({
    "docbridge.config.json": JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
    "docbridge.links.json": JSON.stringify({
      links: [{ code: "src/login.ts#login", doc: "docs/auth.md#login-spec" }],
    }),
    "src/login.ts": `${docTag}export function ${symbolName}() {}\n`,
    "docs/auth.md": `${codeTag}## Login Spec\n`,
  });
}
