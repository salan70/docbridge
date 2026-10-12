import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveScannerWorkerCommand } from "../../src/scan/code/worker/scanner-executable";
import type { GateLanguage, GateTarget } from "./result-diff";

const REPO_ROOT = resolve(import.meta.dir, "../..");

/** Where `just build-parser-gate` puts the candidate; see `parser_gate_target_dir` in the justfile. */
export const CANDIDATE_BINARY = join(REPO_ROOT, ".tmp/parser-gate/target/release/parser-gate");

export function parseTarget(value: string | undefined): GateTarget {
  if (value === "shipped" || value === "candidate") {
    return value;
  }
  throw new Error(`target must be "shipped" or "candidate", got ${JSON.stringify(value)}`);
}

/** The worker command for a target. Throws when the target is not built. */
export function resolveWorkerCommand(target: GateTarget, language: GateLanguage): string[] {
  if (target === "candidate") {
    if (!existsSync(CANDIDATE_BINARY)) {
      throw new Error(
        `candidate binary not found at ${CANDIDATE_BINARY}; run \`just build-parser-gate\``,
      );
    }
    return [CANDIDATE_BINARY, "scan"];
  }
  const resolution = resolveScannerWorkerCommand(language);
  if (!resolution.ok) {
    throw new Error(`shipped ${language} worker unavailable: ${resolution.diagnostic.message}`);
  }
  return resolution.command;
}
