import { resolveLinks } from "../link/resolver";
import { sortDiagnostics, summarizeDiagnostics } from "../model/diagnostics";
import type { CheckResult } from "../model/types";
import type { CodeAdapterOverrides } from "../scan/code/dispatch";
import { scanProject } from "./project-scan";

type CheckOptions = {
  projectRoot: string;
  audit?: boolean;
  adapters?: CodeAdapterOverrides;
};

/**
 * Full orchestration: load config, collect managed files, read and scan them,
 * resolve link relationships, then merge, sort, and summarize all diagnostics.
 *
 * @doc docs/specs/cli.md#check-command
 * @doc docs/user/commands.md#check-validate-the-project
 */
export function check(options: CheckOptions): CheckResult {
  const audit = options.audit ?? false;
  const outcome = scanProject({
    projectRoot: options.projectRoot,
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
  });
  if (!outcome.ok) {
    // Config errors short-circuit scanning; report only config diagnostics.
    const sorted = sortDiagnostics(outcome.diagnostics);
    return { diagnostics: sorted, summary: summarizeDiagnostics(sorted) };
  }

  const { codeFiles, docFiles, diagnostics: scanDiagnostics } = outcome.scan;

  const relationshipDiagnostics = resolveLinks({
    codeFiles,
    docFiles,
    scanDiagnostics,
    audit,
  });

  const merged = sortDiagnostics([...scanDiagnostics, ...relationshipDiagnostics]);
  return { diagnostics: merged, summary: summarizeDiagnostics(merged) };
}
