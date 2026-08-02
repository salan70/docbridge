import type { CodeLanguageAdapter } from "./code-scanner";
import type { CodeLanguage } from "./types";

/** Internal adapter registry shared by scanning and test-only registry setup. */
export const codeAdapters: Partial<Record<CodeLanguage, CodeLanguageAdapter>> = {};
