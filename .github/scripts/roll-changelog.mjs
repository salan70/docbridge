#!/usr/bin/env node
// Rolls CHANGELOG.md for a release:
//   - moves the `## [Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD`
//     heading, leaving a fresh empty `## [Unreleased]` section,
//   - refreshes the link references at the bottom,
//   - writes the released section to release-notes.md for the PR body.
//
// Required env: VERSION (X.Y.Z), REPOSITORY (owner/repo).
// Fails loudly when `## [Unreleased]` is missing or has no entries, since that
// means the release would ship with empty notes.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.VERSION;
const repository = process.env.REPOSITORY;
if (!version) {
  throw new Error("VERSION env var is required");
}
if (!repository) {
  throw new Error("REPOSITORY env var is required");
}

const path = "CHANGELOG.md";
const original = readFileSync(path, "utf8");
const lines = original.split("\n");

const isVersionHeading = (line) => line.startsWith("## [");
const isLinkRef = (line) => /^\[[^\]]+\]:\s/.test(line);

// Locate the Unreleased section.
const unreleasedStart = lines.findIndex((l) => l.startsWith("## [Unreleased]"));
if (unreleasedStart === -1) {
  throw new Error(
    "CHANGELOG.md has no '## [Unreleased]' section. Add one with entries before preparing a release.",
  );
}

// The section body runs until the next version heading (or EOF / link refs).
let bodyEnd = lines.length;
for (let i = unreleasedStart + 1; i < lines.length; i++) {
  if (isVersionHeading(lines[i]) || isLinkRef(lines[i])) {
    bodyEnd = i;
    break;
  }
}

const body = lines
  .slice(unreleasedStart + 1, bodyEnd)
  .join("\n")
  .trim();
if (body === "") {
  throw new Error(
    "'## [Unreleased]' has no entries. Document user-facing changes before preparing a release.",
  );
}

const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

// Rebuild the heading region: empty Unreleased, then the dated release section.
const newHeadingBlock = ["## [Unreleased]", "", `## [${version}] - ${today}`, "", body, ""].join(
  "\n",
);

const before = lines.slice(0, unreleasedStart);
const after = lines.slice(bodyEnd);
let rebuilt = [...before, ...newHeadingBlock.split("\n"), ...after];

// Refresh link references. Drop any existing [Unreleased] ref, then insert the
// new [Unreleased] compare link and the [X.Y.Z] tag link before the first ref.
rebuilt = rebuilt.filter((l) => !/^\[Unreleased\]:\s/.test(l));
const base = `https://github.com/${repository}`;
const unreleasedRef = `[Unreleased]: ${base}/compare/v${version}...HEAD`;
const versionRef = `[${version}]: ${base}/releases/tag/v${version}`;

const firstRefIndex = rebuilt.findIndex(isLinkRef);
if (firstRefIndex === -1) {
  // No link-reference block yet; append one separated by a blank line.
  if (rebuilt[rebuilt.length - 1] !== "") {
    rebuilt.push("");
  }
  rebuilt.push(unreleasedRef, versionRef);
} else {
  rebuilt.splice(firstRefIndex, 0, unreleasedRef, versionRef);
}

let output = rebuilt.join("\n");
if (!output.endsWith("\n")) {
  output += "\n";
}
writeFileSync(path, output);

writeFileSync("release-notes.md", `${body}\n`);

console.log(`Rolled CHANGELOG.md for v${version} (${today}).`);
