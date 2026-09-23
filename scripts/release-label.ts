#!/usr/bin/env bun

// Required pull request check for per-PR releases. Each pull request carries
// exactly one `release: <kind>` label, and its manifests and CHANGELOG must
// match that label against the base branch. Release Publish then ships every
// merged pull request labeled patch, minor, or major.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { nextVersion, type VersionBump, versionedManifestPaths } from "./set-release-version";

export type ReleaseKind = "none" | VersionBump;

/** The release-relevant state of one commit. */
export type ReleaseSnapshot = {
  /** Manifest path to its `version` field. */
  versions: Record<string, string>;
  changelog: string;
};

const releaseKinds: ReleaseKind[] = ["none", "patch", "minor", "major"];
const labelPrefix = "release: ";

export function releaseKindFromLabels(labels: string[]): ReleaseKind {
  const releaseLabels = labels.filter((label) => label.startsWith(labelPrefix));
  if (releaseLabels.length === 0) {
    const choices = releaseKinds.map((kind) => `${labelPrefix}${kind}`);
    throw new Error(
      `Add exactly one release label: ${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}.`,
    );
  }
  if (releaseLabels.length > 1) {
    throw new Error(
      `Found ${releaseLabels.length} release labels (${releaseLabels.join(", ")}); keep exactly one.`,
    );
  }
  const label = releaseLabels[0] as string;
  const kind = label.slice(labelPrefix.length);
  if (!isReleaseKind(kind)) {
    throw new Error(`Unknown release label '${label}'.`);
  }
  return kind;
}

/** Returns every mismatch between the label and the change; empty when valid. */
export function validateReleaseChange(
  kind: ReleaseKind,
  base: ReleaseSnapshot,
  head: ReleaseSnapshot,
): string[] {
  const baseVersion = rootVersion(base);
  if (kind === "none") {
    const problems = versionedManifestPaths
      .filter((path) => head.versions[path] !== baseVersion)
      .map(
        (path) =>
          `${path} version must stay ${baseVersion} for release: none (found ${head.versions[path]}).`,
      );
    if (unreleasedBody(head.changelog) !== unreleasedBody(base.changelog)) {
      problems.push(
        "CHANGELOG.md [Unreleased] must stay unchanged for release: none. Use a releasing label for user-facing changes.",
      );
    }
    return problems;
  }

  const expected = nextVersion(baseVersion, kind);
  const fix = `Run \`just release-bump ${kind}\`.`;
  const problems = versionedManifestPaths
    .filter((path) => head.versions[path] !== expected)
    .map(
      (path) =>
        `${path} version must be ${expected} for release: ${kind} (found ${head.versions[path]}). ${fix}`,
    );
  if (!changelogSection(head.changelog, `## [${expected}]`)) {
    problems.push(`CHANGELOG.md needs a non-empty '## [${expected}]' section. ${fix}`);
  }
  if (unreleasedBody(head.changelog) !== "") {
    problems.push(`CHANGELOG.md [Unreleased] must be empty after the roll. ${fix}`);
  }
  return problems;
}

function isReleaseKind(value: string): value is ReleaseKind {
  return (releaseKinds as string[]).includes(value);
}

function rootVersion(snapshot: ReleaseSnapshot): string {
  const version = snapshot.versions["package.json"];
  if (version === undefined) {
    throw new Error("package.json has no version field");
  }
  return version;
}

function unreleasedBody(changelog: string): string {
  return changelogSection(changelog, "## [Unreleased]") ?? "";
}

/** The trimmed body under the first heading that starts with `heading`. */
function changelogSection(changelog: string, heading: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex(
    (line, index) => index > start && (line.startsWith("## [") || /^\[[^\]]+\]:\s/.test(line)),
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function readSnapshot(read: (path: string) => string): ReleaseSnapshot {
  const versions: Record<string, string> = {};
  for (const path of versionedManifestPaths) {
    const version = (JSON.parse(read(path)) as Record<string, unknown>)["version"];
    if (typeof version !== "string") {
      throw new Error(`${path} has no version field`);
    }
    versions[path] = version;
  }
  return { versions, changelog: read("CHANGELOG.md") };
}

function readAtRef(root: string, ref: string, path: string): string {
  const result = Bun.spawnSync({
    cmd: ["git", "show", `${ref}:${path}`],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot read ${path} at ${ref}: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout);
}

function parseLabels(json: string | undefined): string[] {
  const labels: unknown = JSON.parse(json ?? "[]");
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) {
    throw new Error("PR_LABELS must be a JSON array of label names");
  }
  return labels;
}

if (import.meta.main) {
  try {
    const root = resolve(Bun.argv[2] ?? join(import.meta.dir, ".."));
    const baseRef = process.env["BASE_REF"];
    if (!baseRef) {
      throw new Error("BASE_REF is required");
    }
    const kind = releaseKindFromLabels(parseLabels(process.env["PR_LABELS"]));
    const base = readSnapshot((path) => readAtRef(root, baseRef, path));
    const head = readSnapshot((path) => readFileSync(join(root, path), "utf8"));
    const problems = validateReleaseChange(kind, base, head);
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log(
      `release: ${kind} matches the change (${rootVersion(base)} -> ${rootVersion(head)}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
