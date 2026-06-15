import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  codeFileOwners,
  isCodeLanguage,
  KNOWN_CODE_LANGUAGES,
  type CodeInclude,
  type CodeIncludeEntry,
} from "./code-language";
import { validateGlobPattern } from "./glob";
import type { CodeLanguage, SpecLinkDiagnostic } from "./types";

export type SpecLinkConfig = {
  include: {
    code: CodeInclude;
    docs: string[];
  };
};

export type LoadConfigResult = {
  config: SpecLinkConfig;
  diagnostics: SpecLinkDiagnostic[];
  ok: boolean;
};

const CONFIG_FILE_NAME = "speclink.config.json";

// Config errors short-circuit scanning, so this placeholder is never scanned.
const EMPTY_CONFIG: SpecLinkConfig = {
  include: { code: {}, docs: [] },
};

const KNOWN_TOP_LEVEL_KEYS = new Set(["$schema", "include"]);
const KNOWN_INCLUDE_KEYS = new Set(["code", "docs"]);
const KNOWN_CODE_ENTRY_KEYS = new Set(["patterns", "visibility"]);

const LANGUAGE_SUFFIX: Record<CodeLanguage, string> = {
  typescript: ".ts",
  swift: ".swift",
  dart: ".dart",
};

/**
 * Load `speclink.config.json` from `projectRoot`, then validate it.
 *
 * The config file is required; a missing file is reported as an error rather
 * than silently falling back to a default. When the parsed config is otherwise
 * valid, the project files are collected to reject any code file claimed by
 * more than one configured language.
 *
 * @doc docs/specs/configuration.md#loading-configuration
 */
export function loadConfig(projectRoot: string): LoadConfigResult {
  let rawText: string | undefined;
  try {
    rawText = readFileSync(join(projectRoot, CONFIG_FILE_NAME), "utf8");
  } catch {
    rawText = undefined;
  }

  const resolved = resolveConfig(rawText);
  if (!resolved.ok) {
    return resolved;
  }

  const overlapDiagnostics = detectLanguageOverlap(
    projectRoot,
    resolved.config.include.code,
  );
  if (overlapDiagnostics.length === 0) {
    return resolved;
  }
  return {
    config: EMPTY_CONFIG,
    diagnostics: [...resolved.diagnostics, ...overlapDiagnostics],
    ok: false,
  };
}

/**
 * Validate already-read config text. `undefined` means the file is absent,
 * which is an error: the config file is required. Invalid input yields config
 * diagnostics, and `ok` is false whenever any error exists so the caller can
 * skip scanning.
 */
export function resolveConfig(rawText: string | undefined): LoadConfigResult {
  if (rawText === undefined) {
    return {
      config: EMPTY_CONFIG,
      ok: false,
      diagnostics: [
        configDiagnostic(
          "config_file_invalid",
          CONFIG_FILE_NAME,
          `${CONFIG_FILE_NAME} was not found. SpecLink requires a configuration file.`,
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      config: EMPTY_CONFIG,
      ok: false,
      diagnostics: [
        configDiagnostic(
          "config_file_invalid",
          CONFIG_FILE_NAME,
          `Failed to parse ${CONFIG_FILE_NAME}: ${reason}`,
        ),
      ],
    };
  }

  const diagnostics: SpecLinkDiagnostic[] = [];

  if (!isPlainObject(parsed)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        CONFIG_FILE_NAME,
        "Configuration must be a JSON object.",
      ),
    );
    return { config: EMPTY_CONFIG, diagnostics, ok: false };
  }

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_unknown_key",
          key,
          `Unknown top-level configuration key: ${key}`,
        ),
      );
    }
  }

  if ("$schema" in parsed && typeof parsed.$schema !== "string") {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "$schema",
        "`$schema` must be a string.",
      ),
    );
  }

  const include = parsed.include;
  if (!isPlainObject(include)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "include",
        "`include` must be an object with `code` and `docs`.",
      ),
    );
    return { config: EMPTY_CONFIG, diagnostics, ok: false };
  }

  for (const key of Object.keys(include)) {
    if (!KNOWN_INCLUDE_KEYS.has(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_unknown_key",
          `include.${key}`,
          `Unknown configuration key under \`include\`: ${key}`,
        ),
      );
    }
  }

  const code = validateCodeInclude(include.code, diagnostics);
  validatePatternArray(include.docs, "docs", ".md", false, diagnostics);

  const ok = diagnostics.length === 0;
  const config: SpecLinkConfig = ok
    ? { include: { code, docs: include.docs as string[] } }
    : EMPTY_CONFIG;

  return { config, diagnostics, ok };
}

/**
 * Validate the language-keyed `include.code` map. The old array form is
 * intentionally invalid. Returns the parsed map (empty when invalid; callers
 * gate on `ok`).
 */
function validateCodeInclude(
  value: unknown,
  diagnostics: SpecLinkDiagnostic[],
): CodeInclude {
  if (Array.isArray(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "include.code",
        "`include.code` must be a language-keyed object such as `{ \"typescript\": { \"patterns\": [\"src/**/*.ts\"] } }`, not an array.",
      ),
    );
    return {};
  }

  if (!isPlainObject(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "include.code",
        "`include.code` must be a language-keyed object.",
      ),
    );
    return {};
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "include.code",
        "`include.code` must configure at least one language.",
      ),
    );
    return {};
  }

  const result: CodeInclude = {};
  for (const key of keys) {
    if (!isCodeLanguage(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_invalid_value",
          `include.code.${key}`,
          `Unknown code language: ${key}. Supported languages: ${KNOWN_CODE_LANGUAGES.join(", ")}.`,
        ),
      );
      continue;
    }
    const entry = validateCodeEntry(key, value[key], diagnostics);
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result;
}

function validateCodeEntry(
  language: CodeLanguage,
  value: unknown,
  diagnostics: SpecLinkDiagnostic[],
): CodeIncludeEntry | undefined {
  const target = `include.code.${language}`;

  if (!isPlainObject(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        target,
        `\`${target}\` must be an object with a \`patterns\` array. Shorthand arrays are not supported.`,
      ),
    );
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (!KNOWN_CODE_ENTRY_KEYS.has(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_unknown_key",
          `${target}.${key}`,
          `Unknown configuration key under \`${target}\`: ${key}`,
        ),
      );
    }
  }

  const before = diagnostics.length;
  validatePatternArray(
    value.patterns,
    `code.${language}.patterns`,
    LANGUAGE_SUFFIX[language],
    language === "typescript",
    diagnostics,
  );

  if ("visibility" in value && !isStringArray(value.visibility)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        `${target}.visibility`,
        `\`${target}.visibility\` must be an array of strings.`,
      ),
    );
  }

  if (diagnostics.length !== before) {
    return undefined;
  }

  const entry: CodeIncludeEntry = { patterns: value.patterns as string[] };
  if (isStringArray(value.visibility)) {
    entry.visibility = value.visibility;
  }
  return entry;
}

function validatePatternArray(
  value: unknown,
  field: string,
  requiredSuffix: string,
  excludeDeclarationFiles: boolean,
  diagnostics: SpecLinkDiagnostic[],
): void {
  const target = `include.${field}`;

  if (!Array.isArray(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        target,
        `\`${target}\` must be a non-empty array of strings.`,
      ),
    );
    return;
  }

  if (value.length === 0) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        target,
        `\`${target}\` must contain at least one pattern.`,
      ),
    );
    return;
  }

  for (const pattern of value) {
    if (typeof pattern !== "string") {
      diagnostics.push(
        configDiagnostic(
          "config_invalid_value",
          target,
          `\`${target}\` patterns must be strings.`,
        ),
      );
      continue;
    }

    const globResult = validateGlobPattern(pattern);
    if (!globResult.ok) {
      diagnostics.push(
        configDiagnostic(
          "config_invalid_value",
          pattern,
          `Invalid pattern in \`${target}\`: ${globResult.message}`,
        ),
      );
      continue;
    }

    const suffixError = checkSuffix(pattern, requiredSuffix, excludeDeclarationFiles);
    if (suffixError !== undefined) {
      diagnostics.push(
        configDiagnostic("config_invalid_value", pattern, suffixError),
      );
    }
  }
}

function checkSuffix(
  pattern: string,
  requiredSuffix: string,
  excludeDeclarationFiles: boolean,
): string | undefined {
  if (!pattern.endsWith(requiredSuffix)) {
    return `Pattern must end with \`${requiredSuffix}\`.`;
  }
  if (excludeDeclarationFiles && pattern.endsWith(".d.ts")) {
    return "Pattern must not target `.d.ts` declaration files.";
  }
  return undefined;
}

/**
 * Reject any code file matched by more than one configured language. Requires
 * the filesystem, so it runs in `loadConfig` rather than `resolveConfig`.
 */
function detectLanguageOverlap(
  projectRoot: string,
  code: CodeInclude,
): SpecLinkDiagnostic[] {
  const diagnostics: SpecLinkDiagnostic[] = [];
  for (const [relPath, owners] of codeFileOwners(projectRoot, code)) {
    if (owners.length > 1) {
      diagnostics.push(
        configDiagnostic(
          "config_invalid_value",
          relPath,
          `Code file ${relPath} matches multiple configured languages (${owners.join(", ")}). Each code file must belong to exactly one language.`,
        ),
      );
    }
  }
  return diagnostics;
}

function configDiagnostic(
  code: SpecLinkDiagnostic["code"],
  target: string,
  message: string,
): SpecLinkDiagnostic {
  return { severity: "error", code, target, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
