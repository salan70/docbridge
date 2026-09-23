import type { CodeScanResult } from "./code-scanner";
import { collectErroredFiles } from "./diagnostics";
import type { LinkManifest, LinkManifestEntry } from "./link-manifest";
import type { MarkdownScanResult } from "./markdown";
import { nearestMatch } from "./suggest";
import type {
  CodeSymbolEndpoint,
  DocHeadingOutline,
  LinkAnnotation,
  DocBridgeDiagnostic,
} from "./types";

type ApplyInput = {
  manifest: LinkManifest;
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  /** Upstream diagnostics, read only to skip files whose scan is incomplete. */
  scanDiagnostics: DocBridgeDiagnostic[];
};

type ApplyResult = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  diagnostics: DocBridgeDiagnostic[];
};

/**
 * Turn each manifest entry into the pair of links an annotation pair would
 * have produced, so the resolver, the graph, and every command treat declared
 * links and annotated links the same way.
 *
 * The function is pure: it returns new scan results and leaves its input
 * untouched. An entry resolves against `symbols` plus `undocumentedSymbols`,
 * because a declared link is exactly the case where the code side carries no
 * annotation of its own.
 *
 * @doc docs/specs/link-manifest.md#applying-manifest-links
 */
export function applyLinkManifest(input: ApplyInput): ApplyResult {
  if (input.manifest.entries.length === 0) {
    return { codeFiles: input.codeFiles, docFiles: input.docFiles, diagnostics: [] };
  }

  const state = new ApplyState(input);
  for (const entry of input.manifest.entries) {
    state.applyEntry(entry);
  }
  return state.result();
}

/** A code file's scan result plus the endpoint index the applier needs. */
type CodeFileState = {
  file: CodeScanResult;
  symbols: CodeSymbolEndpoint[];
  undocumentedSymbols: CodeSymbolEndpoint[];
  links: LinkAnnotation[];
  /** Every visible endpoint of the file, documented or not. */
  byEndpoint: Map<string, CodeSymbolEndpoint>;
  outgoing: Set<string>;
  changed: boolean;
};

type DocFileState = {
  file: MarkdownScanResult;
  headings: DocHeadingOutline[];
  links: LinkAnnotation[];
  anchors: Set<string>;
  outgoing: Set<string>;
  changed: boolean;
};

class ApplyState {
  private readonly erroredFiles: Set<string>;
  private readonly codeStates = new Map<string, CodeFileState>();
  private readonly docStates = new Map<string, DocFileState>();
  private readonly codeOrder: CodeScanResult[];
  private readonly docOrder: MarkdownScanResult[];
  private readonly diagnostics: DocBridgeDiagnostic[] = [];

  constructor(input: ApplyInput) {
    this.erroredFiles = collectErroredFiles(input.scanDiagnostics);
    this.codeOrder = input.codeFiles;
    this.docOrder = input.docFiles;

    for (const file of input.codeFiles) {
      const byEndpoint = new Map<string, CodeSymbolEndpoint>();
      for (const symbol of [...file.symbols, ...file.undocumentedSymbols]) {
        if (!byEndpoint.has(symbol.endpoint)) {
          byEndpoint.set(symbol.endpoint, symbol);
        }
      }
      this.codeStates.set(file.filePath, {
        file,
        symbols: file.symbols,
        undocumentedSymbols: file.undocumentedSymbols,
        links: file.links,
        byEndpoint,
        outgoing: new Set(
          file.links.map((annotation) => pairKey(annotation.source, annotation.target)),
        ),
        changed: false,
      });
    }

    for (const file of input.docFiles) {
      this.docStates.set(file.filePath, {
        file,
        headings: file.headings,
        links: file.links,
        anchors: new Set(file.anchors.map((anchor) => anchor.endpoint)),
        outgoing: new Set(
          file.links.map((annotation) => pairKey(annotation.source, annotation.target)),
        ),
        changed: false,
      });
    }
  }

  applyEntry(entry: LinkManifestEntry): void {
    if (this.erroredFiles.has(entry.code.filePath) || this.erroredFiles.has(entry.doc.filePath)) {
      return;
    }

    const codeResolved = this.resolveCodeSide(entry);
    const docResolved = this.resolveDocSide(entry);
    if (!codeResolved || !docResolved) {
      return;
    }

    this.addLinks(entry);
  }

  /** Resolve the code endpoint, marking it documented when it exists. */
  private resolveCodeSide(entry: LinkManifestEntry): boolean {
    const state = this.codeStates.get(entry.code.filePath);
    if (state === undefined) {
      this.report(
        "code_file_not_found",
        entry.codeEndpoint,
        `Code file ${entry.code.filePath} declared in the link manifest is not in the managed code set.`,
        entry,
        "code",
      );
      return false;
    }

    const symbol = state.byEndpoint.get(entry.codeEndpoint);
    if (symbol === undefined) {
      this.report(
        "code_symbol_not_found",
        entry.codeEndpoint,
        this.symbolNotFoundMessage(entry, state),
        entry,
        "code",
        state.file.language,
      );
      return false;
    }

    this.markDocumented(state, symbol);
    return true;
  }

  /** Resolve the doc anchor, marking its heading annotated when it exists. */
  private resolveDocSide(entry: LinkManifestEntry): boolean {
    const state = this.docStates.get(entry.doc.filePath);
    if (state === undefined) {
      this.report(
        "doc_file_not_found",
        entry.docEndpoint,
        `Doc file ${entry.doc.filePath} declared in the link manifest is not in the managed docs set.`,
        entry,
        "doc",
      );
      return false;
    }

    if (!state.anchors.has(entry.docEndpoint)) {
      this.report(
        "doc_anchor_not_found",
        entry.docEndpoint,
        `Doc anchor ${entry.docEndpoint} declared in the link manifest does not exist.`,
        entry,
        "doc",
      );
      return false;
    }

    this.markAnnotated(state, entry.docEndpoint);
    return true;
  }

  private addLinks(entry: LinkManifestEntry): void {
    const codeState = this.codeStates.get(entry.code.filePath);
    const docState = this.docStates.get(entry.doc.filePath);
    if (codeState === undefined || docState === undefined) {
      return;
    }

    const forward = pairKey(entry.codeEndpoint, entry.docEndpoint);
    const backward = pairKey(entry.docEndpoint, entry.codeEndpoint);
    const hasForward = codeState.outgoing.has(forward);
    const hasBackward = docState.outgoing.has(backward);

    if (hasForward || hasBackward) {
      this.diagnostics.push({
        severity: "warning",
        code: "duplicate_link",
        source: entry.codeEndpoint,
        target: entry.docEndpoint,
        message: `Link ${entry.codeEndpoint} to ${entry.docEndpoint} is already declared.`,
        location: entry.location,
        range: entry.range,
      });
    }

    if (!hasForward) {
      codeState.links = [
        ...codeState.links,
        manifestLink(entry.codeEndpoint, entry.docEndpoint, entry, "doc"),
      ];
      codeState.outgoing.add(forward);
      codeState.changed = true;
    }
    if (!hasBackward) {
      docState.links = [
        ...docState.links,
        manifestLink(entry.docEndpoint, entry.codeEndpoint, entry, "code"),
      ];
      docState.outgoing.add(backward);
      docState.changed = true;
    }
  }

  /**
   * Move a symbol out of the undocumented set. A manifest link documents the
   * endpoint as surely as a `@doc` tag does, and audit reads that set.
   */
  private markDocumented(state: CodeFileState, symbol: CodeSymbolEndpoint): void {
    if (!state.undocumentedSymbols.includes(symbol)) {
      return;
    }
    state.undocumentedSymbols = state.undocumentedSymbols.filter(
      (candidate) => candidate !== symbol,
    );
    state.symbols = [...state.symbols, symbol];
    state.changed = true;
  }

  private markAnnotated(state: DocFileState, endpoint: string): void {
    const index = state.headings.findIndex((heading) => heading.anchor?.endpoint === endpoint);
    const heading = state.headings[index];
    if (heading === undefined || heading.hasCodeAnnotation) {
      return;
    }
    state.headings = state.headings.toSpliced(index, 1, {
      ...heading,
      hasCodeAnnotation: true,
    });
    state.changed = true;
  }

  private symbolNotFoundMessage(entry: LinkManifestEntry, state: CodeFileState): string {
    const base = `Code symbol ${entry.codeEndpoint} declared in the link manifest does not exist.`;
    const candidates = [...state.byEndpoint.values()].map((symbol) => symbol.canonicalId);
    const suggestion = nearestMatch(entry.code.fragment, candidates);
    return suggestion === undefined ? base : `${base} Did you mean \`${suggestion}\`?`;
  }

  private report(
    code: DocBridgeDiagnostic["code"],
    target: string,
    message: string,
    entry: LinkManifestEntry,
    side: "code" | "doc",
    language?: CodeScanResult["language"],
  ): void {
    const range = side === "code" ? entry.codeRange : entry.docRange;
    const diagnostic: DocBridgeDiagnostic = {
      severity: "error",
      code,
      target,
      message,
      location: { ...entry.location, line: range.start.line, column: range.start.column },
      range,
    };
    if (language !== undefined) {
      diagnostic.language = language;
    }
    this.diagnostics.push(diagnostic);
  }

  result(): ApplyResult {
    const codeFiles = this.codeOrder.map((file) => {
      const state = this.codeStates.get(file.filePath);
      if (state === undefined || !state.changed) {
        return file;
      }
      return {
        ...file,
        symbols: state.symbols,
        undocumentedSymbols: state.undocumentedSymbols,
        links: state.links,
      };
    });

    const docFiles = this.docOrder.map((file) => {
      const state = this.docStates.get(file.filePath);
      if (state === undefined || !state.changed) {
        return file;
      }
      return { ...file, headings: state.headings, links: state.links };
    });

    return { codeFiles, docFiles, diagnostics: this.diagnostics };
  }
}

/** Index key for one directed link. Endpoints never contain whitespace. */
function pairKey(source: string, target: string): string {
  return `${source} -> ${target}`;
}

function manifestLink(
  source: string,
  target: string,
  entry: LinkManifestEntry,
  side: "code" | "doc",
): LinkAnnotation {
  return {
    source,
    target,
    location: entry.location,
    targetRange: side === "code" ? entry.codeRange : entry.docRange,
  };
}
