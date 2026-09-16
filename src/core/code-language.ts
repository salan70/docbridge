import { collectFiles } from "./glob";
import { comparePaths } from "./path-order";
import type { CodeLanguage, DocBridgeDiagnostic } from "./types";

/**
 * Language metadata and managed-file collection.
 *
 * Configuration validation and repository discovery need to know which
 * languages exist and which files they claim, but not how to parse them. This
 * module therefore stays free of adapter registration, concrete parsers, and
 * worker execution; those live in `./code-scan` and `./scanner-executable`.
 */

/**
 * A configured code language entry. Every entry is an object; shorthand pattern
 * arrays are not accepted.
 *
 * @doc docs/specs/configuration.md#code-languages
 */
export type CodeIncludeEntry = {
  patterns: string[];
  /** Optional language-specific visibility scope; validated per adapter. */
  visibility?: string[];
};

/** The language-keyed `include.code` map. */
export type CodeInclude = Partial<Record<CodeLanguage, CodeIncludeEntry>>;

/** Fixed, ordered set of supported code language IDs. */
export const KNOWN_CODE_LANGUAGES: readonly CodeLanguage[] = [
  "typescript",
  "swift",
  "dart",
  "rust",
];

export function isCodeLanguage(value: string): value is CodeLanguage {
  return (KNOWN_CODE_LANGUAGES as readonly string[]).includes(value);
}

export type CollectedCodeFile = {
  language: CodeLanguage;
  relPath: string;
};

/** The outcome of reading one managed code file, from disk or an editor buffer. */
export type CodeFileRead =
  | { ok: true; content: string }
  | { ok: false; diagnostic: DocBridgeDiagnostic };

/**
 * Collect every managed code file across configured languages, each tagged with
 * its owning language. Results are unique and sorted by path. Files claimed by
 * more than one language are rejected at config load (see {@link codeFileOwners}).
 */
export function collectCodeFiles(
  projectRoot: string,
  codeInclude: CodeInclude,
): CollectedCodeFile[] {
  const collected: CollectedCodeFile[] = [];
  const seen = new Set<string>();
  for (const language of KNOWN_CODE_LANGUAGES) {
    const entry = codeInclude[language];
    if (entry === undefined) {
      continue;
    }
    for (const relPath of collectFiles(projectRoot, entry.patterns)) {
      if (seen.has(relPath)) {
        // Defensive: overlap is rejected at config load, so a repeat here would
        // only occur from concurrent edits. Keep the first owning language.
        continue;
      }
      seen.add(relPath);
      collected.push({ language, relPath });
    }
  }
  collected.sort((left, right) => comparePaths(left.relPath, right.relPath));
  return collected;
}

/**
 * Map each managed code file to the configured languages whose patterns match
 * it. Used by config validation to reject a file claimed by multiple languages.
 */
export function codeFileOwners(
  projectRoot: string,
  codeInclude: CodeInclude,
): Map<string, CodeLanguage[]> {
  const owners = new Map<string, CodeLanguage[]>();
  for (const language of KNOWN_CODE_LANGUAGES) {
    const entry = codeInclude[language];
    if (entry === undefined) {
      continue;
    }
    for (const relPath of collectFiles(projectRoot, entry.patterns)) {
      const existing = owners.get(relPath);
      if (existing === undefined) {
        owners.set(relPath, [language]);
      } else if (!existing.includes(language)) {
        existing.push(language);
      }
    }
  }
  return owners;
}
