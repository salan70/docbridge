import { collectCodeFiles, scanCodeFiles } from "./code-language";
import type { CodeScanResult } from "./code-scanner";
import { loadConfig } from "./config";
import { pluralize, sortDiagnostics, summarizeDiagnostics } from "./diagnostics";
import { collectFiles, readManagedFile } from "./glob";
import { parseLinkTarget } from "./links";
import { scanMarkdown, type MarkdownScanResult } from "./markdown";
import type {
  CheckResult,
  DocAnchorEndpoint,
  DocHeadingOutline,
  LinkAnnotation,
  DocBridgeDiagnostic,
} from "./types";

export type ResolveInput = {
  /** One per scanned code file, including files that hit a parse error. */
  codeFiles: CodeScanResult[];
  /** One per scanned `.md` file. */
  docFiles: MarkdownScanResult[];
  /**
   * Diagnostics collected upstream (config, file_read_error, code_parse_error,
   * and the scanner diagnostics). They are not re-emitted here, but
   * `file_read_error` / `code_parse_error` entries are used to suppress derived
   * link diagnostics.
   */
  scanDiagnostics: DocBridgeDiagnostic[];
  audit: boolean;
};

/**
 * Resolve scanner outputs into relationship diagnostics following the
 * pair-based model in `docs/specs/link-resolution.md`.
 *
 * Returns only the relationship diagnostics (link resolution plus audit). It
 * does NOT re-include the upstream scanner diagnostics; the orchestrator merges
 * the two sets. The returned list is unsorted; the orchestrator sorts the
 * final, merged set.
 *
 * @doc docs/specs/link-resolution.md#resolving-links
 */
export function resolveLinks(input: ResolveInput): DocBridgeDiagnostic[] {
  const diagnostics: DocBridgeDiagnostic[] = [];

  const erroredFiles = collectErroredFiles(input.scanDiagnostics);
  const docFilePaths = new Set(input.docFiles.map((file) => file.filePath));
  const codeFilePaths = new Set(input.codeFiles.map((file) => file.filePath));

  // Anchors present per doc file, keyed by their full `file#anchor` endpoint.
  const docAnchorEndpoints = new Set<string>();
  for (const file of input.docFiles) {
    for (const anchor of file.anchors) {
      docAnchorEndpoints.add(anchor.endpoint);
    }
  }

  // All directed links, used to find matching backlinks. A pair `code -> doc`
  // and `doc -> code` is valid only when both directions exist between the
  // same endpoints. We index doc->code links by `${docEndpoint}->${codeEndpoint}`
  // and code->doc links by `${codeEndpoint}->${docEndpoint}`.
  const docToCodePairs = new Set<string>();
  for (const file of input.docFiles) {
    if (erroredFiles.has(file.filePath)) {
      continue;
    }
    for (const link of file.links) {
      docToCodePairs.add(pairKey(link.source, link.target));
    }
  }

  const codeToDocPairs = new Set<string>();
  for (const file of input.codeFiles) {
    if (erroredFiles.has(file.filePath)) {
      continue;
    }
    for (const link of file.links) {
      codeToDocPairs.add(pairKey(link.source, link.target));
    }
  }

  // Resolve each TypeScript @doc link (code -> doc).
  for (const file of input.codeFiles) {
    if (erroredFiles.has(file.filePath)) {
      // Links originating from an errored file are derived from it; suppress.
      continue;
    }
    for (const link of file.links) {
      const docEndpoint = link.target;
      const docFilePath = filePathOf(docEndpoint);

      // Suppress when the targeted doc file is errored (read/parse failure).
      if (erroredFiles.has(docFilePath)) {
        continue;
      }

      if (!docFilePaths.has(docFilePath)) {
        diagnostics.push(
          relationshipDiagnostic(
            "doc_file_not_found",
            link.source,
            docEndpoint,
            `Doc file ${docFilePath} referenced by ${link.source} is not in the managed docs set.`,
            link,
          ),
        );
        continue;
      }

      if (!docAnchorEndpoints.has(docEndpoint)) {
        diagnostics.push(
          relationshipDiagnostic(
            "doc_anchor_not_found",
            link.source,
            docEndpoint,
            `Doc anchor ${docEndpoint} referenced by ${link.source} does not exist.`,
            link,
          ),
        );
        continue;
      }

      // Anchor exists; require a matching @code backlink to this exact endpoint.
      if (!docToCodePairs.has(pairKey(docEndpoint, link.source))) {
        diagnostics.push(
          relationshipDiagnostic(
            "doc_backlink_not_found",
            link.source,
            docEndpoint,
            `Doc anchor ${docEndpoint} has no matching @code backlink to ${link.source}.`,
            link,
          ),
        );
      }
    }
  }

  // Resolve each Markdown @code link (doc -> code).
  for (const file of input.docFiles) {
    if (erroredFiles.has(file.filePath)) {
      // Links originating from an errored doc file are derived from it.
      continue;
    }
    for (const link of file.links) {
      const codeEndpoint = link.target;
      const codeFilePath = filePathOf(codeEndpoint);

      // Suppress when the targeted code file is errored (read/parse failure).
      if (erroredFiles.has(codeFilePath)) {
        continue;
      }

      if (!codeFilePaths.has(codeFilePath)) {
        diagnostics.push(
          relationshipDiagnostic(
            "code_file_not_found",
            link.source,
            codeEndpoint,
            `Code file ${codeFilePath} referenced by ${link.source} is not in the managed code set.`,
            link,
          ),
        );
        continue;
      }

      // File exists; require a matching @doc pair back to this doc endpoint.
      if (!codeToDocPairs.has(pairKey(codeEndpoint, link.source))) {
        diagnostics.push(
          relationshipDiagnostic(
            "code_backlink_not_found",
            link.source,
            codeEndpoint,
            `Code endpoint ${codeEndpoint} has no matching @doc pair back to ${link.source}.`,
            link,
          ),
        );
      }
    }
  }

  if (input.audit) {
    diagnostics.push(...auditUndocumentedSymbols(input, erroredFiles));
    diagnostics.push(...auditUnlinkedDocSections(input, erroredFiles));
  }

  return diagnostics;
}

export type CheckOptions = {
  projectRoot: string;
  audit?: boolean;
};

/**
 * Full orchestration: load config, collect managed files, read and scan them,
 * resolve link relationships, then merge, sort, and summarize all diagnostics.
 */
export function check(options: CheckOptions): CheckResult {
  const { projectRoot } = options;
  const audit = options.audit ?? false;

  const configResult = loadConfig(projectRoot);
  if (!configResult.ok) {
    // Config errors short-circuit scanning; report only config diagnostics.
    const sorted = sortDiagnostics(configResult.diagnostics);
    return { diagnostics: sorted, summary: summarizeDiagnostics(sorted) };
  }

  const scanDiagnostics: DocBridgeDiagnostic[] = [...configResult.diagnostics];

  const codeScan = scanCodeFiles(
    projectRoot,
    collectCodeFiles(projectRoot, configResult.config.include.code),
    configResult.config.include.code,
    (relPath) => readManagedFile(projectRoot, relPath),
  );
  const codeFiles = codeScan.codeFiles;
  scanDiagnostics.push(...codeScan.diagnostics);

  const docFiles: MarkdownScanResult[] = [];
  for (const relPath of collectFiles(projectRoot, configResult.config.include.docs)) {
    const read = readManagedFile(projectRoot, relPath);
    if (!read.ok) {
      scanDiagnostics.push(read.diagnostic);
      continue;
    }
    const scan = scanMarkdown(relPath, read.content);
    scanDiagnostics.push(...scan.diagnostics);
    docFiles.push(scan);
  }

  const relationshipDiagnostics = resolveLinks({
    codeFiles,
    docFiles,
    scanDiagnostics,
    audit,
  });

  const merged = sortDiagnostics([...scanDiagnostics, ...relationshipDiagnostics]);
  return { diagnostics: merged, summary: summarizeDiagnostics(merged) };
}

/**
 * Audit rule: emit `undocumented_symbol` for supported exported code endpoints
 * that have no `@doc` annotation. The TypeScript scanner classifies each
 * supported exported declaration as documented or not and surfaces the latter as
 * `undocumentedSymbols`, so this rule simply reports those endpoints for
 * non-suppressed files.
 */
function auditUndocumentedSymbols(
  input: ResolveInput,
  erroredFiles: Set<string>,
): DocBridgeDiagnostic[] {
  const diagnostics: DocBridgeDiagnostic[] = [];

  for (const file of input.codeFiles) {
    if (erroredFiles.has(file.filePath)) {
      continue;
    }
    for (const symbol of file.undocumentedSymbols) {
      diagnostics.push({
        severity: "warning",
        code: "undocumented_symbol",
        language: symbol.language,
        target: symbol.endpoint,
        message: `Exported symbol ${symbol.endpoint} has no @doc annotation.`,
        location: symbol.location,
      });
    }
  }

  return diagnostics;
}

/** A heading and the headings nested under it, reconstructed from heading levels. */
type HeadingNode = {
  heading: DocHeadingOutline;
  children: HeadingNode[];
};

/**
 * Audit rule: emit `unlinked_doc_section` for documentation sections that have
 * no `@code` annotation anywhere in their subtree.
 *
 * Reporting is rolled up: only the topmost heading of a fully unannotated
 * subtree is reported, and its descendants are suppressed. A heading with no
 * annotation of its own but an annotated descendant is not reported either,
 * because the subtree is already bridged somewhere. This keeps the diagnostic
 * proportional to the number of unbridged regions rather than to the number of
 * headings, which is what makes it usable on a partially adopted repository.
 *
 * A heading counts as annotated whenever a `@code` comment is attached to it,
 * even if that annotation is unparsable or unresolvable. Those cases already
 * produce their own errors, and treating them as unlinked would wrongly collapse
 * the surrounding subtree into a single roll-up.
 */
function auditUnlinkedDocSections(
  input: ResolveInput,
  erroredFiles: Set<string>,
): DocBridgeDiagnostic[] {
  const diagnostics: DocBridgeDiagnostic[] = [];

  for (const file of input.docFiles) {
    if (erroredFiles.has(file.filePath)) {
      continue;
    }
    reportUnlinkedSections(buildHeadingTree(file.headings), diagnostics);
  }

  return diagnostics;
}

/**
 * Rebuild the document's heading tree from the outline in document order, using
 * the same nesting rule as `extractDocSection` in `./section`: a heading's
 * subtree runs until the next heading whose level is less than or equal to its
 * own.
 *
 * The outline is used rather than the anchors because empty headings create no
 * anchor yet still close the preceding section. Dropping them would let a
 * deeper heading after an empty one be absorbed into the section before it,
 * which is not the region `extractDocSection` would return.
 */
function buildHeadingTree(headings: DocHeadingOutline[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const openAncestors: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { heading, children: [] };

    while (
      openAncestors.length > 0 &&
      (openAncestors[openAncestors.length - 1]?.heading.level ?? 0) >= heading.level
    ) {
      openAncestors.pop();
    }

    const parent = openAncestors[openAncestors.length - 1];
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    openAncestors.push(node);
  }

  return roots;
}

/**
 * Walk the tree, reporting the topmost reportable node of every fully
 * unannotated subtree.
 *
 * An empty heading has no anchor and so cannot be reported. It still shapes the
 * tree, so reporting descends through it and reports its children instead.
 */
function reportUnlinkedSections(nodes: HeadingNode[], diagnostics: DocBridgeDiagnostic[]): void {
  for (const node of nodes) {
    const anchor = node.heading.anchor;
    if (anchor === undefined || subtreeHasAnnotation(node)) {
      reportUnlinkedSections(node.children, diagnostics);
      continue;
    }
    diagnostics.push(unlinkedDocSectionDiagnostic(node, anchor));
  }
}

function subtreeHasAnnotation(node: HeadingNode): boolean {
  return node.heading.hasCodeAnnotation || node.children.some(subtreeHasAnnotation);
}

function countDescendants(node: HeadingNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function unlinkedDocSectionDiagnostic(
  node: HeadingNode,
  anchor: DocAnchorEndpoint,
): DocBridgeDiagnostic {
  const suppressed = countDescendants(node);
  const suffix =
    suppressed === 0
      ? ""
      : ` (${suppressed} descendant ${pluralize("heading", suppressed)} suppressed)`;

  const diagnostic: DocBridgeDiagnostic = {
    severity: "warning",
    code: "unlinked_doc_section",
    target: anchor.endpoint,
    message: `Doc section ${anchor.endpoint} has no @code annotation${suffix}.`,
    location: anchor.location,
  };
  if (anchor.headingTextRange !== undefined) {
    diagnostic.range = anchor.headingTextRange;
  }
  return diagnostic;
}

function collectErroredFiles(diagnostics: DocBridgeDiagnostic[]): Set<string> {
  const errored = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.code === "file_read_error" ||
      diagnostic.code === "code_parse_error" ||
      isFileScopedScannerDiagnostic(diagnostic)
    ) {
      errored.add(diagnostic.target);
    }
  }
  return errored;
}

function isFileScopedScannerDiagnostic(diagnostic: DocBridgeDiagnostic): boolean {
  return (
    (diagnostic.code === "code_scanner_unavailable" || diagnostic.code === "code_scanner_failed") &&
    diagnostic.language !== undefined &&
    diagnostic.target !== diagnostic.language
  );
}

function pairKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function filePathOf(endpoint: string): string {
  // Endpoints are produced by parseLinkTarget-validated `file#fragment` forms,
  // so they contain exactly one `#`. Split on the first to be defensive.
  const parsed = parseLinkTarget(endpoint);
  if (parsed.ok) {
    return parsed.target.filePath;
  }
  const hashIndex = endpoint.indexOf("#");
  return hashIndex === -1 ? endpoint : endpoint.slice(0, hashIndex);
}

function relationshipDiagnostic(
  code: DocBridgeDiagnostic["code"],
  source: string,
  target: string,
  message: string,
  link: LinkAnnotation,
): DocBridgeDiagnostic {
  const diagnostic: DocBridgeDiagnostic = {
    severity: "error",
    code,
    source,
    target,
    message,
    location: link.location,
  };
  if (link.targetRange !== undefined) {
    diagnostic.range = link.targetRange;
  }
  return diagnostic;
}
