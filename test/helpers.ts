import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CliIo } from "../src/cli/index";
import { buildLinkGraph, type LinkGraph } from "../src/core/graph";
import { scanMarkdown } from "../src/core/markdown";
import type { DocBridgeDiagnostic } from "../src/core/types";
import { scanTypeScript } from "../src/core/typescript";

export type Captured = {
  readonly out: string;
  readonly err: string;
  io: CliIo;
};

export function capture(): Captured {
  const state = { out: "", err: "" };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      stdout: (text) => {
        state.out += text;
      },
      stderr: (text) => {
        state.err += text;
      },
    },
  };
}

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

export function graphFrom(
  sourcesOrCode: GraphSources | Array<[string, string]>,
  docs: Array<[string, string]> = [],
): LinkGraph {
  const sources = Array.isArray(sourcesOrCode) ? { code: sourcesOrCode, docs } : sourcesOrCode;
  return buildLinkGraph(
    sources.code.map(([filePath, content]) => scanTypeScript(filePath, content)),
    sources.docs.map(([filePath, content]) => scanMarkdown(filePath, content)),
  );
}
