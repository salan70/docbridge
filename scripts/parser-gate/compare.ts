import type { ScannerWorkerRequest } from "../../src/scan/code/worker/scanner-worker";

export type GateLanguage = "swift" | "dart";

export type GateTarget = "shipped" | "candidate";

/** The path each language's input is scanned as, per the plan's specified fixtures. */
const SPECIFIED_PATH: Readonly<Record<GateLanguage, string>> = {
  swift: "Sources/Input.swift",
  dart: "lib/input.dart",
};

/** Parser messages and positions differ per parser, so only the code is compared. */
const PARSE_ERROR_CODE = "code_parse_error";

type SpecifiedOptions = { visibility?: string[] };

/** The one-file request a specified case sends to a worker. */
export function specifiedRequest(
  language: GateLanguage,
  content: string,
  options: SpecifiedOptions,
  requestId: string,
): ScannerWorkerRequest {
  return {
    schemaVersion: 1,
    requestId,
    language,
    projectRoot: "/",
    files: [{ filePath: SPECIFIED_PATH[language], content }],
    options,
  };
}

/**
 * The location of the first difference between two JSON values, as a
 * JSON-pointer-like path, or `undefined` when they are equal. Object key order
 * is ignored, array order is not, and a `code_parse_error` diagnostic is
 * compared by `code` alone.
 */
export function firstDifference(expected: unknown, actual: unknown): string | undefined {
  return differ(normalize(expected), normalize(actual), "");
}

/** One result line: `ok` or `FAIL`, the case, and where the first difference is. */
export function formatResultLine(name: string, difference: string | undefined): string {
  return difference === undefined
    ? `ok   ${name}`
    : `FAIL ${name} (first difference at ${difference === "" ? "/" : difference})`;
}

function normalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    return key === "diagnostics" ? items.map(reduceParseError) : items;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, member]) => member !== undefined);
    return Object.fromEntries(entries.map(([name, member]) => [name, normalize(member, name)]));
  }
  return value;
}

function reduceParseError(diagnostic: unknown): unknown {
  return typeof diagnostic === "object" &&
    diagnostic !== null &&
    "code" in diagnostic &&
    diagnostic.code === PARSE_ERROR_CODE
    ? { code: PARSE_ERROR_CODE }
    : diagnostic;
}

function differ(expected: unknown, actual: unknown, path: string): string | undefined {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const found = differ(expected[index], actual[index], `${path}/${index}`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].toSorted();
    for (const name of names) {
      const found = differ(expected[name], actual[name], `${path}/${name}`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  return Object.is(expected, actual) ? undefined : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
