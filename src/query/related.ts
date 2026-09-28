import { isAbsolute, relative } from "node:path";

import { counterpartsOf, type GraphEndpoint, type LinkGraph } from "../link/graph";
import { compareEndpointOrder } from "../model/endpoint";
import type { DocBridgeDiagnostic } from "../model/types";
import { scanProject } from "./project-scan";

type RelatedCounterpart = {
  endpoint: string;
  filePath: string;
  inChangeSet: boolean;
};

type RelatedEndpoint = {
  endpoint: string;
  counterparts: RelatedCounterpart[];
};

type RelatedFile = {
  filePath: string;
  endpoints: RelatedEndpoint[];
};

export type RelatedSummary = {
  changedFiles: number;
  filesWithLinks: number;
};

export type RelatedResult = {
  files: RelatedFile[];
  summary: RelatedSummary;
};

/**
 * Normalize raw changed-file paths (as emitted by `git diff --name-only` or
 * typed by hand) into the root-relative form used by scan results: absolute
 * paths are relativized against `projectRoot`, leading `./` segments are
 * stripped, empty entries are dropped, and duplicates are deduplicated.
 */
export function normalizeChangedPaths(projectRoot: string, paths: string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      continue;
    }
    const relativized = isAbsolute(trimmed) ? relative(projectRoot, trimmed) : trimmed;
    normalized.add(relativized.replace(/^(\.\/)+/, ""));
  }
  return [...normalized];
}

/**
 * List the counterparts of every linked endpoint in the given changed files.
 * Changed files without counterparts are omitted from `files` but counted in
 * `summary.changedFiles`.
 */
export function computeRelated(graph: LinkGraph, changedFiles: string[]): RelatedResult {
  const changedSet = new Set(changedFiles);

  const sortedPaths = [...changedSet].toSorted((left, right) => left.localeCompare(right));
  const endpointsByFile = indexEndpointsByFile(graph);

  const files: RelatedFile[] = [];
  for (const filePath of sortedPaths) {
    const endpoints: RelatedEndpoint[] = [];
    for (const endpoint of endpointsByFile.get(filePath) ?? []) {
      const counterparts = counterpartsOf(graph, endpoint.endpoint).map((counterpart) => ({
        endpoint: counterpart.endpoint,
        filePath: counterpart.filePath,
        inChangeSet: changedSet.has(counterpart.filePath),
      }));
      if (counterparts.length > 0) {
        endpoints.push({ endpoint: endpoint.endpoint, counterparts });
      }
    }
    if (endpoints.length > 0) {
      files.push({ filePath, endpoints });
    }
  }

  return {
    files,
    summary: { changedFiles: changedSet.size, filesWithLinks: files.length },
  };
}

export type RelatedGateViolation = {
  changedEndpoint: string;
  changedFilePath: string;
  counterpartEndpoint: string;
  counterpartFilePath: string;
};

/**
 * Collect the gate violations in a `RelatedResult`: every counterpart whose
 * file is not itself in the change set, in result order.
 *
 * @doc docs/specs/cli.md#related-gate-mode
 */
export function collectGateViolations(result: RelatedResult): RelatedGateViolation[] {
  const violations: RelatedGateViolation[] = [];
  for (const file of result.files) {
    for (const endpoint of file.endpoints) {
      for (const counterpart of endpoint.counterparts) {
        if (!counterpart.inChangeSet) {
          violations.push({
            changedEndpoint: endpoint.endpoint,
            changedFilePath: file.filePath,
            counterpartEndpoint: counterpart.endpoint,
            counterpartFilePath: counterpart.filePath,
          });
        }
      }
    }
  }
  return violations;
}

type RelatedOptions = {
  projectRoot: string;
  /** Raw changed-file paths; normalized with `normalizeChangedPaths`. */
  changedFiles: string[];
};

type RelatedOutcome =
  | { ok: true; result: RelatedResult }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

/**
 * Full orchestration for `docbridge related`: load config, scan the managed
 * files, build the link graph, and compute the counterparts of the changed
 * files. Unreadable files are skipped silently; `docbridge check` is the
 * surface that reports them.
 *
 * @doc docs/specs/cli.md#related-command
 * @doc docs/user/commands.md#related-find-counterpart-files
 * @doc docs/user/automation.md#editing-workflow
 */
export function related(options: RelatedOptions): RelatedOutcome {
  const outcome = scanProject({ projectRoot: options.projectRoot, buildGraph: true });
  if (!outcome.ok) {
    return { ok: false, diagnostics: outcome.diagnostics };
  }

  const changedFiles = normalizeChangedPaths(options.projectRoot, options.changedFiles);
  return { ok: true, result: computeRelated(outcome.scan.graph, changedFiles) };
}

/** Index every graph endpoint by file path, each file's list sorted by position. */
function indexEndpointsByFile(graph: LinkGraph): Map<string, GraphEndpoint[]> {
  const byFile = new Map<string, GraphEndpoint[]>();
  const add = (endpoint: GraphEndpoint): void => {
    const existing = byFile.get(endpoint.filePath);
    if (existing === undefined) {
      byFile.set(endpoint.filePath, [endpoint]);
    } else {
      existing.push(endpoint);
    }
  };
  for (const code of graph.codeByEndpoint.values()) {
    add(code);
  }
  for (const doc of graph.docByEndpoint.values()) {
    add(doc);
  }
  for (const endpoints of byFile.values()) {
    endpoints.sort((left, right) =>
      compareEndpointOrder(
        { ...left.location, endpoint: left.endpoint },
        { ...right.location, endpoint: right.endpoint },
      ),
    );
  }
  return byFile;
}
