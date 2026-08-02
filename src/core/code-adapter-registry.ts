import type { CodeLanguageAdapter } from "./code-scanner";
import type { CodeLanguage } from "./types";

/** Internal adapter registry shared by scanning and test-only registry setup. */
export const codeAdapters: Partial<Record<CodeLanguage, CodeLanguageAdapter>> = {};

/** The registered adapter for a language, or `undefined` when none exists yet. */
export function getCodeAdapter(language: CodeLanguage): CodeLanguageAdapter | undefined {
  return codeAdapters[language];
}
