#!/usr/bin/env bun

import { resolve } from "node:path";

import { check } from "../src/core/resolver";

const repoRoot = resolve(import.meta.dir, "..");

export const AUDIT_CODES = ["undocumented_symbol", "unlinked_doc_section"] as const;
export const BASELINE_CLASSES = [
  "internal_helper",
  "test_support",
  "sibling_export",
  "structural_doc",
  "actionable_follow_up",
] as const;

export type AuditCode = (typeof AUDIT_CODES)[number];
export type BaselineClass = (typeof BASELINE_CLASSES)[number];

export type AuditKey = {
  code: AuditCode;
  target: string;
};

export type BaselineEntry = AuditKey & {
  class: BaselineClass;
};

export type BaselineFile = {
  version: 1;
  entries: BaselineEntry[];
};

export type AuditDiagnosticLike = {
  code: string;
  target: string;
  message?: string;
  location?: {
    filePath?: string;
    line?: number;
    column?: number;
  };
};

export type BaselineDiff = {
  added: AuditKey[];
  removed: AuditKey[];
};

export type BaselineComparison = { ok: true } | { ok: false; message: string };

const AUDIT_CODE_SET = new Set<string>(AUDIT_CODES);
const BASELINE_CLASS_SET = new Set<string>(BASELINE_CLASSES);

function isAuditCode(value: string): value is AuditCode {
  return AUDIT_CODE_SET.has(value);
}

function isBaselineClass(value: string): value is BaselineClass {
  return BASELINE_CLASS_SET.has(value);
}

function compareAuditKeys(left: AuditKey, right: AuditKey): number {
  const codeOrder = left.code.localeCompare(right.code);
  if (codeOrder !== 0) {
    return codeOrder;
  }
  return left.target.localeCompare(right.target);
}

function keyId(key: AuditKey): string {
  return `${key.code}\0${key.target}`;
}

/**
 * Reduce live diagnostics to the stable audit identity: diagnostic code plus
 * canonical target. Message text and line numbers are ignored.
 */
export function normalizeAuditKeys(diagnostics: readonly AuditDiagnosticLike[]): AuditKey[] {
  const unique = new Map<string, AuditKey>();

  for (const diagnostic of diagnostics) {
    if (!isAuditCode(diagnostic.code)) {
      continue;
    }
    const key: AuditKey = { code: diagnostic.code, target: diagnostic.target };
    unique.set(keyId(key), key);
  }

  return [...unique.values()].toSorted(compareAuditKeys);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Baseline ${path} must be a non-empty string.`);
  }
  return value;
}

/**
 * Parse the committed baseline document. Unknown review classes fail loudly so
 * a new category cannot slip in without a policy update.
 */
export function parseBaseline(raw: unknown): BaselineFile {
  if (!isRecord(raw)) {
    throw new Error("Baseline must be a JSON object.");
  }
  if (raw.version !== 1) {
    throw new Error("Baseline version must be 1.");
  }
  if (!Array.isArray(raw.entries)) {
    throw new Error("Baseline entries must be an array.");
  }

  const entries: BaselineEntry[] = raw.entries.map((entry, index) => {
    const path = `entries[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`Baseline ${path} must be an object.`);
    }

    const code = readStringField(entry, "code", `${path}.code`);
    if (!isAuditCode(code)) {
      throw new Error(`Baseline ${path}.code is not an audit diagnostic code.`);
    }

    const reviewClass = readStringField(entry, "class", `${path}.class`);
    if (!isBaselineClass(reviewClass)) {
      throw new Error(`Baseline ${path}.class has unknown review class "${reviewClass}".`);
    }

    return {
      code,
      target: readStringField(entry, "target", `${path}.target`),
      class: reviewClass,
    };
  });

  const seen = new Set<string>();
  for (const entry of entries) {
    const id = keyId(entry);
    if (seen.has(id)) {
      throw new Error(`Baseline contains duplicate key ${entry.code} ${entry.target}.`);
    }
    seen.add(id);
  }

  return { version: 1, entries };
}

export function diffAuditBaseline(
  live: readonly AuditKey[],
  baseline: readonly AuditKey[],
): BaselineDiff {
  const liveIds = new Set(live.map(keyId));
  const baselineIds = new Set(baseline.map(keyId));

  const added = live.filter((key) => !baselineIds.has(keyId(key))).toSorted(compareAuditKeys);
  const removed = baseline.filter((key) => !liveIds.has(keyId(key))).toSorted(compareAuditKeys);

  return { added, removed };
}

export function formatBaselineDiff(diff: BaselineDiff): string {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push("Unreviewed audit targets (add a reciprocal link or a classified baseline entry):");
    for (const key of diff.added) {
      lines.push(`  unreviewed audit target: ${key.code} ${key.target}`);
    }
  }

  if (diff.removed.length > 0) {
    lines.push("Stale baseline entries (remove them in the same change that closed the gap):");
    for (const key of diff.removed) {
      lines.push(`  stale baseline entry: ${key.code} ${key.target}`);
    }
  }

  return lines.join("\n");
}

export function compareAuditBaseline(
  diagnostics: readonly AuditDiagnosticLike[],
  baseline: BaselineFile,
): BaselineComparison {
  const diff = diffAuditBaseline(normalizeAuditKeys(diagnostics), baseline.entries);
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return { ok: true };
  }
  return { ok: false, message: formatBaselineDiff(diff) };
}

export const BASELINE_PATH = "test-fixtures/self-audit/baseline.json";

export async function compareRepositoryAuditBaseline(
  projectRoot: string,
): Promise<BaselineComparison> {
  const outcome = check({ projectRoot, audit: true });
  const baseline = parseBaseline(await Bun.file(resolve(projectRoot, BASELINE_PATH)).json());
  return compareAuditBaseline(outcome.diagnostics, baseline);
}

if (import.meta.main) {
  const result = await compareRepositoryAuditBaseline(repoRoot);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
