import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseJsonSource,
  type JsonMember,
  type JsonNode,
  type JsonObjectNode,
  type JsonStringNode,
} from "./json-source";
import { parseLinkTarget } from "./links";
import type { DocBridgeDiagnostic, LinkTarget, Range, SourceLocation } from "./types";

export const LINK_MANIFEST_FILE_NAME = "docbridge.links.json";

/** One declared link, with the source positions its diagnostics point at. */
export type LinkManifestEntry = {
  code: LinkTarget;
  doc: LinkTarget;
  codeEndpoint: string;
  docEndpoint: string;
  /** Free-form text for human readers. It reaches no command output. */
  note?: string;
  /** Start of the entry object, used when a diagnostic covers the whole entry. */
  location: SourceLocation;
  /** Range of the entry object. */
  range: Range;
  /** Range of the `code` value, excluding its quotes. */
  codeRange: Range;
  /** Range of the `doc` value, excluding its quotes. */
  docRange: Range;
};

export type LinkManifest = {
  entries: LinkManifestEntry[];
};

export type LoadLinkManifestResult =
  | { ok: true; manifest: LinkManifest; diagnostics: DocBridgeDiagnostic[] }
  | { ok: false; diagnostics: DocBridgeDiagnostic[] };

const KNOWN_TOP_LEVEL_KEYS = new Set(["$schema", "links"]);
const KNOWN_ENTRY_KEYS = new Set(["code", "doc", "note"]);

const EMPTY_MANIFEST: LinkManifest = { entries: [] };

/**
 * Load the optional link manifest from `projectRoot`.
 *
 * An absent file is not an error: the manifest is optional, and a project that
 * links only with annotations never creates one.
 *
 * @doc docs/specs/link-manifest.md#loading-the-manifest
 * @doc docs/user/linking.md#declare-links-in-a-manifest
 */
export function loadLinkManifest(projectRoot: string): LoadLinkManifestResult {
  let rawText: string | undefined;
  try {
    rawText = readFileSync(join(projectRoot, LINK_MANIFEST_FILE_NAME), "utf8");
  } catch {
    rawText = undefined;
  }
  return resolveLinkManifest(rawText);
}

/**
 * Validate already-read manifest text. `undefined` means the file is absent,
 * which yields an empty manifest.
 *
 * A parse or shape failure sets `ok` to false so the caller stops scanning: a
 * manifest DocBridge cannot read makes the whole declared link set unreliable.
 * A single entry whose target violates the link grammar does not, because the
 * remaining entries are still trustworthy.
 */
export function resolveLinkManifest(rawText: string | undefined): LoadLinkManifestResult {
  if (rawText === undefined) {
    return { ok: true, manifest: EMPTY_MANIFEST, diagnostics: [] };
  }

  const parsed = parseJsonSource(rawText);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [
        manifestDiagnostic(
          "config_file_invalid",
          `Failed to parse ${LINK_MANIFEST_FILE_NAME}: ${parsed.message}`,
          parsed.position,
        ),
      ],
    };
  }

  return validateManifest(parsed.root);
}

function validateManifest(root: JsonNode): LoadLinkManifestResult {
  if (root.kind !== "object") {
    return { ok: false, diagnostics: [invalidValue("", "an object", root)] };
  }

  const diagnostics: DocBridgeDiagnostic[] = [];
  for (const member of root.members) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(member.key)) {
      diagnostics.push(unknownKey(member.key, member));
    }
  }

  const links = root.members.find((member) => member.key === "links");
  if (links === undefined) {
    return {
      ok: false,
      diagnostics: [...diagnostics, invalidValue("links", "present", root)],
    };
  }
  if (links.value.kind !== "array") {
    return {
      ok: false,
      diagnostics: [...diagnostics, invalidValue("links", "an array", links.value)],
    };
  }

  const entries: LinkManifestEntry[] = [];
  for (const [index, element] of links.value.elements.entries()) {
    const outcome = readEntry(element, index);
    diagnostics.push(...outcome.diagnostics);
    if (outcome.entry !== undefined) {
      entries.push(outcome.entry);
    }
  }

  if (diagnostics.some(isBlocking)) {
    return { ok: false, diagnostics };
  }
  return { ok: true, manifest: { entries }, diagnostics };
}

type EntryOutcome = {
  entry?: LinkManifestEntry;
  diagnostics: DocBridgeDiagnostic[];
};

function readEntry(element: JsonNode, index: number): EntryOutcome {
  const path = `links[${index}]`;
  if (element.kind !== "object") {
    return { diagnostics: [invalidValue(path, "an object", element)] };
  }

  const diagnostics: DocBridgeDiagnostic[] = [];
  for (const member of element.members) {
    if (!KNOWN_ENTRY_KEYS.has(member.key)) {
      diagnostics.push(unknownKey(`${path}.${member.key}`, member));
    }
  }

  const code = readString(element, "code", path, diagnostics);
  const doc = readString(element, "doc", path, diagnostics);
  const note = readOptionalNote(element, path, diagnostics);
  if (code === undefined || doc === undefined || diagnostics.some(isBlocking)) {
    return { diagnostics };
  }

  const codeTarget = parseTarget(code, diagnostics);
  const docTarget = parseTarget(doc, diagnostics);
  if (codeTarget === undefined || docTarget === undefined) {
    return { diagnostics };
  }

  const entry: LinkManifestEntry = {
    code: codeTarget,
    doc: docTarget,
    codeEndpoint: code.value,
    docEndpoint: doc.value,
    location: positionOf(element.range),
    range: element.range,
    codeRange: code.contentRange,
    docRange: doc.contentRange,
  };
  if (note !== undefined) {
    entry.note = note;
  }
  return { entry, diagnostics };
}

function readString(
  entry: JsonObjectNode,
  key: "code" | "doc",
  path: string,
  diagnostics: DocBridgeDiagnostic[],
): JsonStringNode | undefined {
  const member = entry.members.find((candidate) => candidate.key === key);
  if (member === undefined) {
    diagnostics.push(invalidValue(`${path}.${key}`, "present", entry));
    return undefined;
  }
  if (member.value.kind !== "string") {
    diagnostics.push(invalidValue(`${path}.${key}`, "a string", member.value));
    return undefined;
  }
  return member.value;
}

function readOptionalNote(
  entry: JsonObjectNode,
  path: string,
  diagnostics: DocBridgeDiagnostic[],
): string | undefined {
  const member = entry.members.find((candidate) => candidate.key === "note");
  if (member === undefined) {
    return undefined;
  }
  if (member.value.kind !== "string") {
    diagnostics.push(invalidValue(`${path}.note`, "a string", member.value));
    return undefined;
  }
  return member.value.value;
}

function parseTarget(
  node: JsonStringNode,
  diagnostics: DocBridgeDiagnostic[],
): LinkTarget | undefined {
  const result = parseLinkTarget(node.value, {
    location: positionOf(node.contentRange),
    targetRange: node.contentRange,
  });
  if (result.ok) {
    return result.target;
  }
  diagnostics.push(result.diagnostic);
  return undefined;
}

/** Whether a diagnostic makes the whole manifest untrustworthy. */
function isBlocking(diagnostic: DocBridgeDiagnostic): boolean {
  return diagnostic.code !== "invalid_link_target";
}

function unknownKey(path: string, member: JsonMember): DocBridgeDiagnostic {
  return manifestDiagnostic(
    "config_unknown_key",
    `Unknown key ${path} in ${LINK_MANIFEST_FILE_NAME}.`,
    positionOf(member.keyRange),
    member.keyRange,
  );
}

function invalidValue(path: string, expectation: string, node: JsonNode): DocBridgeDiagnostic {
  const subject = path === "" ? LINK_MANIFEST_FILE_NAME : path;
  return manifestDiagnostic(
    "config_invalid_value",
    `${subject} must be ${expectation}.`,
    positionOf(node.range),
    node.range,
  );
}

function manifestDiagnostic(
  code: DocBridgeDiagnostic["code"],
  message: string,
  position: { line: number; column: number },
  range?: Range,
): DocBridgeDiagnostic {
  const diagnostic: DocBridgeDiagnostic = {
    severity: "error",
    code,
    target: LINK_MANIFEST_FILE_NAME,
    message,
    location: { filePath: LINK_MANIFEST_FILE_NAME, line: position.line, column: position.column },
  };
  if (range !== undefined) {
    diagnostic.range = range;
  }
  return diagnostic;
}

function positionOf(range: Range): SourceLocation {
  return {
    filePath: LINK_MANIFEST_FILE_NAME,
    line: range.start.line,
    column: range.start.column,
  };
}
