import type { LinkTarget, Range, SourceLocation } from "./types";

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
