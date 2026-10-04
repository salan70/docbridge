#!/usr/bin/env bun

// Locates a CHANGELOG.md section for the release tooling: rolling
// (`.github/scripts/roll-changelog.mjs`), label validation
// (`release-label.ts`), and publication (`release-publish.yml`, which runs
// this file to print one version's release notes).

import { readFileSync } from "node:fs";

/** The heading line index, and the index after the last body line. */
export type ChangelogSectionRange = { start: number; end: number };

/**
 * Locate the section under the first line that starts with `heading`. Its
 * body runs to the next version heading, the link references, or the end.
 */
export function locateChangelogSection(
  lines: string[],
  heading: string,
): ChangelogSectionRange | undefined {
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex(
    (line, index) => index > start && (line.startsWith("## [") || /^\[[^\]]+\]:\s/.test(line)),
  );
  return { start, end: end === -1 ? lines.length : end };
}

/** The trimmed body of the section that `locateChangelogSection` finds. */
export function changelogSection(changelog: string, heading: string): string | undefined {
  const lines = changelog.split("\n");
  const range = locateChangelogSection(lines, heading);
  if (range === undefined) {
    return undefined;
  }
  return lines
    .slice(range.start + 1, range.end)
    .join("\n")
    .trim();
}

if (import.meta.main) {
  const version = Bun.argv[2];
  if (!version) {
    console.error("Usage: changelog-section.ts <version>");
    process.exit(1);
  }
  const notes = changelogSection(readFileSync("CHANGELOG.md", "utf8"), `## [${version}]`);
  if (!notes) {
    console.error(`No changelog section found for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
