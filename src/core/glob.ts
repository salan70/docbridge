import { type Dirent, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { DocBridgeDiagnostic } from "./types";

export type GlobValidation = { ok: true } | { ok: false; message: string };

const IGNORED_SEGMENTS = new Set(["node_modules", ".git"]);

/**
 * Validate a single include pattern's path form and v0.1 glob syntax.
 *
 * Path form rules: project-root-relative POSIX paths only. Absolute paths,
 * `./` prefixes, `../` traversal, and `\` separators are invalid.
 *
 * Glob syntax: only `*` and `**`. `*` matches within a single segment. `**`
 * is valid only as a full path segment. `?`, `[]`, `{}`, negation, and brace
 * expansion are unsupported.
 */
export function validateGlobPattern(pattern: string): GlobValidation {
  if (pattern.length === 0) {
    return { ok: false, message: "Pattern must not be empty." };
  }
  if (pattern.includes("\\")) {
    return { ok: false, message: "Pattern must use POSIX-style `/` separators." };
  }
  if (pattern.startsWith("/")) {
    return { ok: false, message: "Pattern must not be an absolute path." };
  }

  const segments = pattern.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return {
        ok: false,
        message:
          "Pattern must be a project-root-relative path without empty, `.`, or `..` segments.",
      };
    }

    if (segment.includes("**") && segment !== "**") {
      return {
        ok: false,
        message: "`**` is only valid as a full path segment.",
      };
    }

    if (/[?[\]{}()!+@]/.test(segment)) {
      return {
        ok: false,
        message: "Pattern supports only `*` and `**` glob syntax.",
      };
    }
  }

  return { ok: true };
}

/**
 * Match a project-root-relative POSIX path against a validated pattern.
 *
 * Matching is case-sensitive. `*` never crosses `/`; `**` crosses segments.
 */
export function matchGlob(pattern: string, relativePath: string): boolean {
  return new RegExp(globToRegExp(pattern)).test(relativePath);
}

/**
 * Walk the filesystem under `projectRoot` and return sorted
 * project-root-relative POSIX paths matching any of the patterns.
 *
 * Ignore rules: skip `node_modules`, `.git`, any dot-prefixed segment, and
 * symlink files and directories. Code patterns (ending in `.ts`) drop
 * `.d.ts` files, which would otherwise match textually.
 *
 * @doc docs/specs/scanning.md#file-collection
 */
export function collectFiles(projectRoot: string, patterns: string[]): string[] {
  const matched = new Set<string>();

  const walk = (relDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(projectRoot, relDir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".") || IGNORED_SEGMENTS.has(name)) {
        continue;
      }

      const relPath = relDir === "" ? name : `${relDir}/${name}`;
      const absPath = join(projectRoot, relPath);

      let stat;
      try {
        stat = lstatSync(absPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        walk(relPath);
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      for (const pattern of patterns) {
        if (!matchGlob(pattern, relPath)) {
          continue;
        }
        if (isCodePattern(pattern) && relPath.endsWith(".d.ts")) {
          continue;
        }
        matched.add(relPath);
        break;
      }
    }
  };

  walk("");

  return [...matched].toSorted(comparePaths);
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Read a managed file relative to `projectRoot`. Returns content on success
 * or a `file_read_error` diagnostic on failure.
 */
export function readManagedFile(
  projectRoot: string,
  relativePath: string,
): { ok: true; content: string } | { ok: false; diagnostic: DocBridgeDiagnostic } {
  try {
    const content = readFileSync(join(projectRoot, relativePath), "utf8");
    return { ok: true, content };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostic: {
        severity: "error",
        code: "file_read_error",
        target: relativePath,
        message: `Failed to read file: ${reason}`,
      },
    };
  }
}

function isCodePattern(pattern: string): boolean {
  return pattern.endsWith(".ts");
}

function globToRegExp(pattern: string): string {
  const segments = pattern.split("/");
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment === "**") {
      // Match zero or more full segments.
      parts.push("(?:[^/]+/)*");
    } else {
      parts.push(`${segmentToRegExp(segment)}/`);
    }
  }

  // Join segment regexes; the trailing `/` of the final non-`**` segment is
  // stripped, and `**` already produced a trailing slash group.
  let body = parts.join("");
  if (body.endsWith("/")) {
    body = body.slice(0, -1);
  }

  return `^${body}$`;
}

function segmentToRegExp(segment: string): string {
  let result = "";
  for (const char of segment) {
    if (char === "*") {
      result += "[^/]*";
    } else {
      result += escapeRegExpChar(char);
    }
  }
  return result;
}

function escapeRegExpChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}
