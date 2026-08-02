import { sortDiagnostics } from "../../src/core/diagnostics";
import { buildLinkGraph } from "../../src/core/graph";
import { scanMarkdown } from "../../src/core/markdown";
import { resolveLinks } from "../../src/core/resolver";
import { scanTypeScript } from "../../src/core/typescript";
import { buildPositionIndex } from "../../src/lsp/index-lookup";
import type { ProjectState } from "../../src/lsp/project";

export const CODE_FILE = "src/auth/login.ts";
export const DOC_FILE = "docs/auth.md";

/** Assemble a ProjectState from one code file and one doc file, in memory. */
export function stateOf(code: string, doc: string): ProjectState {
  const codeScan = scanTypeScript(CODE_FILE, code);
  const docScan = scanMarkdown(DOC_FILE, doc);
  const graph = buildLinkGraph([codeScan], [docScan]);
  const scanDiagnostics = [...codeScan.diagnostics, ...docScan.diagnostics];
  const relationship = resolveLinks({
    codeFiles: [codeScan],
    docFiles: [docScan],
    scanDiagnostics,
    audit: false,
  });
  return {
    graph,
    index: buildPositionIndex(graph),
    diagnostics: sortDiagnostics([...scanDiagnostics, ...relationship]),
    contentByFile: new Map([
      [CODE_FILE, code],
      [DOC_FILE, doc],
    ]),
  };
}
