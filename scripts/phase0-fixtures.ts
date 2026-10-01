#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildLinkGraph, counterpartsOf, type GraphEndpoint } from "../src/link/graph";
import { resolveLinks } from "../src/link/resolver";
import { sortDiagnostics } from "../src/model/diagnostics";
import type { CodeScanResult, MarkdownScanResult } from "../src/model/scan-result";
import type { DocBridgeDiagnostic } from "../src/model/types";
import { scanProject } from "../src/query/project-scan";
import { canonicalJson } from "./phase0-canonical-json";

/** The document `phase0-runner` reads on stdin. */
export type Phase0Input = {
  codeFiles: CodeScanResult[];
  docFiles: MarkdownScanResult[];
  scanDiagnostics: DocBridgeDiagnostic[];
  audit: boolean;
  queries: string[];
};

/** The document `phase0-runner` writes on stdout. */
export type Phase0Output = {
  diagnostics: DocBridgeDiagnostic[];
  counterparts: Record<string, GraphEndpoint[]>;
};

const REPO_ROOT = resolve(import.meta.dir, "..");
const GENERATED_ROOT = join(REPO_ROOT, "test-fixtures/phase0/generated");
/** Every project directory under these roots becomes one generated case. */
const PROJECT_ROOTS = ["test-fixtures/diagnostics", "test-fixtures/self-audit", "examples"];

/** Run the TypeScript resolver and graph the way the Rust runner must. */
export function runPhase0(input: Phase0Input): Phase0Output {
  const relationship = resolveLinks({
    codeFiles: input.codeFiles,
    docFiles: input.docFiles,
    scanDiagnostics: input.scanDiagnostics,
    audit: input.audit,
  });
  const graph = buildLinkGraph(input.codeFiles, input.docFiles);
  // No prototype, so a query such as `__proto__` is an ordinary key.
  const counterparts: Record<string, GraphEndpoint[]> = Object.create(null);
  for (const query of input.queries) {
    counterparts[query] = counterpartsOf(graph, query);
  }
  return {
    diagnostics: sortDiagnostics([...input.scanDiagnostics, ...relationship]),
    counterparts,
  };
}

/** A DocBridge project is a directory holding `docbridge.config.json`. */
function listProjects(): { name: string; projectRoot: string }[] {
  const projects: { name: string; projectRoot: string }[] = [];
  for (const relRoot of PROJECT_ROOTS) {
    const root = join(REPO_ROOT, relRoot);
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const projectRoot = join(root, entry.name);
      if (!entry.isDirectory() || !existsSync(join(projectRoot, "docbridge.config.json"))) {
        continue;
      }
      projects.push({ name: `${relRoot.split("/").at(-1)}-${entry.name}`, projectRoot });
    }
  }
  return projects.toSorted((left, right) => (left.name < right.name ? -1 : 1));
}

/** Scan one project and freeze the runner input plus the expected output. */
export function generateCase(projectRoot: string): { input: Phase0Input; expected: Phase0Output } {
  const outcome = scanProject({ projectRoot, keepContent: true });
  const scan = outcome.ok
    ? outcome.scan
    : { codeFiles: [], docFiles: [], diagnostics: outcome.diagnostics };
  const queries = [
    ...scan.codeFiles.flatMap((file) =>
      [...file.symbols, ...file.undocumentedSymbols].map((symbol) => symbol.endpoint),
    ),
    ...scan.docFiles.flatMap((file) => file.anchors.map((anchor) => anchor.endpoint)),
  ];
  const input: Phase0Input = {
    codeFiles: scan.codeFiles,
    docFiles: scan.docFiles,
    scanDiagnostics: scan.diagnostics,
    audit: true,
    queries: [...new Set(queries)],
  };
  return { input, expected: runPhase0(input) };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Return the canonical (formatting- and key-order-independent) JSON of a file, or null. */
function readCanonical(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return canonicalJson(JSON.parse(readFileSync(path, "utf8")));
}

function main(args: string[]): number {
  const check = args.includes("--check");
  const drift: string[] = [];
  const expectedDirs = new Set<string>();

  for (const project of listProjects()) {
    const { input, expected } = generateCase(project.projectRoot);
    const caseDir = join(GENERATED_ROOT, project.name);
    expectedDirs.add(project.name);
    const files: [string, unknown][] = [
      ["input.json", input],
      ["expected.json", expected],
    ];
    for (const [fileName, value] of files) {
      const path = join(caseDir, fileName);
      if (check) {
        if (readCanonical(path) !== canonicalJson(value)) {
          drift.push(`${project.name}/${fileName}`);
        }
        continue;
      }
      mkdirSync(caseDir, { recursive: true });
      writeFileSync(path, serialize(value));
    }
  }

  if (existsSync(GENERATED_ROOT)) {
    for (const entry of readdirSync(GENERATED_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || expectedDirs.has(entry.name)) {
        continue;
      }
      if (check) {
        drift.push(`${entry.name}/ (stale case)`);
      } else {
        rmSync(join(GENERATED_ROOT, entry.name), { recursive: true });
      }
    }
  }

  if (drift.length > 0) {
    console.error("Generated Phase 0 fixtures are out of date; run `just phase0-fixtures`:");
    for (const path of drift) {
      console.error(`  ${path}`);
    }
    return 1;
  }
  console.log(`${expectedDirs.size} generated Phase 0 cases ${check ? "up to date" : "written"}.`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
