import { codeAdapters } from "../src/core/code-adapter-registry";
import type { CodeLanguageAdapter } from "../src/core/code-scanner";
import type { CodeLanguage } from "../src/core/types";

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
