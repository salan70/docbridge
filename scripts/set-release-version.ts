#!/usr/bin/env bun

// Single writer for the versions that must stay aligned across a release: the
// npm package manifest and the VS Code extension manifest. `scripts/
// vscode-extension.ts#assertReleaseInputs` refuses to package a VSIX when the
// two disagree, so Release Prepare bumps both through this script.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type VersionBump = "major" | "minor" | "patch";

/** Every manifest whose `version` field is part of one release. */
export const versionedManifestPaths = ["package.json", "editors/vscode/package.json"];

const repoRoot = resolve(import.meta.dir, "..");
const semanticVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(current: string, bump: VersionBump): string {
  const match = semanticVersionPattern.exec(current);
  if (match === null) {
    throw new Error(`${current} is not a X.Y.Z semantic version`);
  }
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Sets `version` in every versioned manifest under `root` and returns the paths
 * it rewrote. Nothing is written unless every manifest is valid, so a rejected
 * input cannot leave the manifests half-updated.
 */
export function setReleaseVersion(root: string, version: string): string[] {
  if (!semanticVersionPattern.test(version)) {
    throw new Error(`${version} is not a X.Y.Z semantic version`);
  }

  const updates = versionedManifestPaths.map((relative) => {
    const manifest = readJson(join(root, relative));
    if (typeof manifest["version"] !== "string") {
      throw new Error(`${relative} has no version field`);
    }
    return { relative, contents: { ...manifest, version } };
  });

  for (const update of updates) {
    writeFileSync(
      join(root, update.relative),
      `${JSON.stringify(update.contents, null, 2)}\n`,
      "utf8",
    );
  }
  return versionedManifestPaths;
}

/**
 * Applies `bump` to the root manifest version and writes the result into every
 * versioned manifest. Returns the new version.
 */
export function bumpReleaseVersion(root: string, bump: VersionBump): string {
  const current = readJson(join(root, "package.json"))["version"];
  if (typeof current !== "string") {
    throw new Error("package.json has no version field");
  }
  const version = nextVersion(current, bump);
  setReleaseVersion(root, version);
  return version;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function isVersionBump(value: string | undefined): value is VersionBump {
  return value === "major" || value === "minor" || value === "patch";
}

function usage(): never {
  throw new Error("Usage: bun run scripts/set-release-version.ts <major|minor|patch> [root]");
}

if (import.meta.main) {
  try {
    const [bump, maybeRoot] = Bun.argv.slice(2);
    if (!isVersionBump(bump)) {
      usage();
    }
    console.log(bumpReleaseVersion(maybeRoot ?? repoRoot, bump));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
