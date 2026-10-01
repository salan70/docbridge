import type { DocBridgeDiagnostic } from "../model/types";

/** The languages whose scanner worker runs on a runtime found on the machine. */
export const RUNTIME_WORKER_LANGUAGES = ["python", "ruby", "java"] as const;

export type RuntimeWorkerLanguage = (typeof RUNTIME_WORKER_LANGUAGES)[number];

/**
 * The optional top-level `scanners` object: per runtime-backed language, the
 * argv that starts its runtime in place of automatic discovery.
 *
 * @doc docs/specs/configuration.md#scanner-runtimes
 */
export type ScannerRuntimes = Partial<Record<RuntimeWorkerLanguage, { command: string[] }>>;

const KNOWN_RUNTIME_ENTRY_KEYS = new Set(["command"]);

/**
 * Validate `scanners`, appending a config diagnostic for every rejected key or
 * value. Returns the accepted entries; callers gate on the diagnostics.
 */
export function validateScannerRuntimes(
  value: unknown,
  diagnostics: DocBridgeDiagnostic[],
): ScannerRuntimes {
  if (!isPlainObject(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        "scanners",
        "`scanners` must be an object keyed by runtime-backed language.",
      ),
    );
    return {};
  }

  const result: ScannerRuntimes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRuntimeWorkerLanguage(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_unknown_key",
          `scanners.${key}`,
          `Unknown scanner runtime: ${key}. Supported runtimes: ${RUNTIME_WORKER_LANGUAGES.join(", ")}.`,
        ),
      );
      continue;
    }
    const command = validateRuntimeEntry(key, entry, diagnostics);
    if (command !== undefined) {
      result[key] = { command };
    }
  }
  return result;
}

function validateRuntimeEntry(
  language: RuntimeWorkerLanguage,
  value: unknown,
  diagnostics: DocBridgeDiagnostic[],
): string[] | undefined {
  const target = `scanners.${language}`;
  if (!isPlainObject(value)) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        target,
        `\`${target}\` must be an object with a \`command\` array.`,
      ),
    );
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (!KNOWN_RUNTIME_ENTRY_KEYS.has(key)) {
      diagnostics.push(
        configDiagnostic(
          "config_unknown_key",
          `${target}.${key}`,
          `Unknown configuration key under \`${target}\`: ${key}`,
        ),
      );
    }
  }

  const command = value.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((part) => typeof part === "string" && part !== "")
  ) {
    diagnostics.push(
      configDiagnostic(
        "config_invalid_value",
        `${target}.command`,
        `\`${target}.command\` must be a non-empty array of non-empty strings: the runtime executable followed by its arguments.`,
      ),
    );
    return undefined;
  }
  return command as string[];
}

function isRuntimeWorkerLanguage(value: string): value is RuntimeWorkerLanguage {
  return (RUNTIME_WORKER_LANGUAGES as readonly string[]).includes(value);
}

function configDiagnostic(
  code: DocBridgeDiagnostic["code"],
  target: string,
  message: string,
): DocBridgeDiagnostic {
  return { severity: "error", code, target, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
