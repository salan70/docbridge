import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateGlobPattern } from "./glob";
import type { SpecLinkDiagnostic } from "./types";

export type SpecLinkConfig = {
  include: {
    code: string[];
    docs: string[];
  };
};

export type LoadConfigResult = {
  config: SpecLinkConfig;
  diagnostics: SpecLinkDiagnostic[];
  ok: boolean;
};

const CONFIG_FILE_NAME = "speclink.config.json";

const DEFAULT_CONFIG: SpecLinkConfig = {
  include: {
    code: ["src/**/*.ts"],
    docs: ["docs/**/*.md"],
  },
};

const KNOWN_TOP_LEVEL_KEYS = new Set(["$schema", "include"]);
const KNOWN_INCLUDE_KEYS = new Set(["code", "docs"]);

/**
 * Load `speclink.config.json` from `projectRoot`, then validate it.
 *
 * When the file is absent, the default config is returned with no diagnostics.
 */
export function loadConfig(projectRoot: string): LoadConfigResult {
  let rawText: string | undefined;
  try {
    rawText = readFileSync(join(projectRoot, CONFIG_FILE_NAME), "utf8");
  } catch {
    rawText = undefined;
  }
  return resolveConfig(rawText);
}

/**
 * Validate already-read config text. `undefined` means the file is absent and
 * the default config applies. Invalid input yields config diagnostics, and
 * `ok` is false whenever any error exists so the caller can skip scanning.
 */
export function resolveConfig(rawText: string | undefined): LoadConfigResult {
  if (rawText === undefined) {
    return { config: DEFAULT_CONFIG, diagnostics: [], ok: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      config: DEFAULT_CONFIG,
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
    return { config: DEFAULT_CONFIG, diagnostics, ok: false };
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
        "`include` must be an object with `code` and `docs` arrays.",
      ),
    );
    return { config: DEFAULT_CONFIG, diagnostics, ok: diagnostics.length === 0 };
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

  validatePatternArray(include.code, "code", ".ts", true, diagnostics);
  validatePatternArray(include.docs, "docs", ".md", false, diagnostics);

  const ok = diagnostics.length === 0;
  const config: SpecLinkConfig = ok
    ? {
        include: {
          code: include.code as string[],
          docs: include.docs as string[],
        },
      }
    : DEFAULT_CONFIG;

  return { config, diagnostics, ok };
}

function validatePatternArray(
  value: unknown,
  field: "code" | "docs",
  requiredSuffix: string,
  isCode: boolean,
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

    const suffixError = checkSuffix(pattern, requiredSuffix, isCode);
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
  isCode: boolean,
): string | undefined {
  if (!pattern.endsWith(requiredSuffix)) {
    return `Pattern must end with \`${requiredSuffix}\`.`;
  }
  if (isCode && pattern.endsWith(".d.ts")) {
    return "Pattern must not target `.d.ts` declaration files.";
  }
  return undefined;
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
