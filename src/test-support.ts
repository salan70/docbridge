import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLinkGraph, type LinkGraph } from "./link/graph";
import type { DocBridgeDiagnostic } from "./model/types";
import { scanTypeScript } from "./scan/code/typescript";
import { scanMarkdown } from "./scan/markdown/markdown";

export function makeProject(
  structure: Record<string, string>,
  prefix = "docbridge-project-",
): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  for (const [relPath, content] of Object.entries(structure)) {
    const absolutePath = join(project, relPath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return project;
}

export function codes(diagnostics: readonly DocBridgeDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

export type GraphSources = {
  code: Array<[string, string]>;
  docs: Array<[string, string]>;
};

export function graphFrom(sources: GraphSources): LinkGraph {
  return buildLinkGraph(
    sources.code.map(([filePath, content]) => scanTypeScript(filePath, content)),
    sources.docs.map(([filePath, content]) => scanMarkdown(filePath, content)),
  );
}
