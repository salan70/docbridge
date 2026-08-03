import { codeAdapters } from "./code-adapter-registry";
import type { CodeLanguageAdapter } from "./code-scanner";
import type { CodeLanguage } from "./types";

/** Temporarily replace a code adapter for one test and return its restore callback. */
export function setCodeAdapterForTest(
  language: CodeLanguage,
  adapter: CodeLanguageAdapter,
): () => void {
  const previous = codeAdapters[language];
  codeAdapters[language] = adapter;
  return () => {
    if (previous === undefined) {
      delete codeAdapters[language];
    } else {
      codeAdapters[language] = previous;
    }
  };
}
