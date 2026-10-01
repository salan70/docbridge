import { createHash } from "node:crypto";

import type { CodeScanResult } from "../../model/scan-result";
import type { CodeLanguage } from "../../model/types";
import type { CodeScanOptions } from "./adapter";

/**
 * Raw code scan results kept from one Language Server scan to the next, keyed
 * by {@link codeScanCacheKey}. `fingerprint` names the configuration the
 * entries were produced under; a different configuration starts empty.
 */
export type CodeScanCache = {
  readonly fingerprint: string;
  readonly entries: ReadonlyMap<string, CodeScanResult>;
};

export function emptyCodeScanCache(): CodeScanCache {
  return { fingerprint: "", entries: new Map() };
}

/**
 * Everything one file's scan result depends on: its language, path, content
 * hash, configured visibility, and the resolved worker argv (`[]` in process).
 */
export function codeScanCacheKey(
  language: CodeLanguage,
  filePath: string,
  content: string,
  options: CodeScanOptions,
  argv: readonly string[],
): string {
  const contentHash = createHash("sha256").update(content).digest("hex");
  return JSON.stringify([language, filePath, contentHash, options.visibility ?? null, argv]);
}

/**
 * Whether a result describes the file rather than a failed scanner, so a later
 * scan may reuse it. A parse error is reused; a scanner failure is retried.
 */
export function isReusableScan(scan: CodeScanResult): boolean {
  return !scan.diagnostics.some(
    (diagnostic) =>
      diagnostic.code === "code_scanner_unavailable" || diagnostic.code === "code_scanner_failed",
  );
}
