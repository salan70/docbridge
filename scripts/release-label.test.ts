import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  type ReleaseSnapshot,
  releaseKindFromLabels,
  validateReleaseChange,
} from "./release-label";

describe("releaseKindFromLabels", () => {
  test("returns the kind of the single release label", () => {
    expect(releaseKindFromLabels(["technical", "release: minor"])).toBe("minor");
  });

  test("rejects a pull request without a release label", () => {
    expect(() => releaseKindFromLabels(["technical"])).toThrow(
      "Add exactly one release label: release: none, release: patch, release: minor, or release: major.",
    );
  });

  test("rejects a pull request with more than one release label", () => {
    expect(() => releaseKindFromLabels(["release: none", "release: patch"])).toThrow(
      "Found 2 release labels (release: none, release: patch); keep exactly one.",
    );
  });

  test("rejects an unknown release label", () => {
    expect(() => releaseKindFromLabels(["release: build"])).toThrow(
      "Unknown release label 'release: build'.",
    );
  });
});

describe("validateReleaseChange", () => {
  const base: ReleaseSnapshot = {
    versions: { "package.json": "0.9.0", "editors/vscode/package.json": "0.9.0" },
    changelog: changelog({ unreleased: "", released: ["0.9.0"] }),
  };

  test("accepts a none change that keeps versions and Unreleased", () => {
    expect(validateReleaseChange("none", base, base)).toEqual([]);
  });

  test("rejects a none change that edits a manifest version", () => {
    const head = { ...base, versions: { ...base.versions, "package.json": "0.9.1" } };

    expect(validateReleaseChange("none", base, head)).toEqual([
      "package.json version must stay 0.9.0 for release: none (found 0.9.1).",
    ]);
  });

  test("rejects a none change that edits the Unreleased section", () => {
    const head = {
      ...base,
      changelog: changelog({ unreleased: "### Fixed\n\n- A fix.", released: ["0.9.0"] }),
    };

    expect(validateReleaseChange("none", base, head)).toEqual([
      "CHANGELOG.md [Unreleased] must stay unchanged for release: none. Use a releasing label for user-facing changes.",
    ]);
  });

  test("accepts a patch change with bumped manifests and a rolled CHANGELOG", () => {
    const head: ReleaseSnapshot = {
      versions: { "package.json": "0.9.1", "editors/vscode/package.json": "0.9.1" },
      changelog: changelog({ unreleased: "", released: ["0.9.1", "0.9.0"] }),
    };

    expect(validateReleaseChange("patch", base, head)).toEqual([]);
  });

  test("rejects manifests that do not carry the expected next version", () => {
    const head: ReleaseSnapshot = {
      versions: { "package.json": "0.9.1", "editors/vscode/package.json": "0.9.0" },
      changelog: changelog({ unreleased: "", released: ["0.10.0", "0.9.0"] }),
    };

    expect(validateReleaseChange("minor", base, head)).toEqual([
      "package.json version must be 0.10.0 for release: minor (found 0.9.1). Run `just release-bump minor`.",
      "editors/vscode/package.json version must be 0.10.0 for release: minor (found 0.9.0). Run `just release-bump minor`.",
    ]);
  });

  test("rejects a release without a non-empty CHANGELOG section for the new version", () => {
    const head: ReleaseSnapshot = {
      versions: { "package.json": "0.9.1", "editors/vscode/package.json": "0.9.1" },
      changelog: changelog({ unreleased: "", released: ["0.9.0"] }),
    };

    expect(validateReleaseChange("patch", base, head)).toEqual([
      "CHANGELOG.md needs a non-empty '## [0.9.1]' section. Run `just release-bump patch`.",
    ]);
  });

  test("rejects a release that leaves entries under Unreleased", () => {
    const head: ReleaseSnapshot = {
      versions: { "package.json": "0.9.1", "editors/vscode/package.json": "0.9.1" },
      changelog: changelog({ unreleased: "- Left behind.", released: ["0.9.1", "0.9.0"] }),
    };

    expect(validateReleaseChange("patch", base, head)).toEqual([
      "CHANGELOG.md [Unreleased] must be empty after the roll. Run `just release-bump patch`.",
    ]);
  });
});

describe("release label CLI", () => {
  test("passes when the head matches the release label against the base commit", () => {
    const root = gitRepo();
    commitRelease(root, "0.9.1", ["0.9.1", "0.9.0"]);

    const result = runCli(root, ["release: patch"]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("release: patch matches the change (0.9.0 -> 0.9.1).");
  });

  test("fails and lists every problem when the head does not match", () => {
    const root = gitRepo();

    const result = runCli(root, ["release: patch"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("package.json version must be 0.9.1 for release: patch");
    expect(result.stderr).toContain("CHANGELOG.md needs a non-empty '## [0.9.1]' section");
  });

  test("fails without a release label", () => {
    const root = gitRepo();

    const result = runCli(root, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Add exactly one release label");
  });
});

function changelog({ unreleased, released }: { unreleased: string; released: string[] }): string {
  const sections = released.map(
    (version) => `## [${version}] - 2026-09-23\n\n- Entry for ${version}.\n`,
  );
  return ["# Changelog", "", "## [Unreleased]", "", unreleased, "", ...sections].join("\n");
}

/** A git repository whose single commit is a 0.9.0 release; returns its path. */
function gitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "docbridge-release-label-"));
  writeSnapshot(root, "0.9.0", ["0.9.0"]);
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  git(root, ["tag", "base"]);
  return root;
}

function commitRelease(root: string, version: string, released: string[]): void {
  writeSnapshot(root, version, released);
  git(root, ["commit", "--quiet", "-am", "release"]);
}

function writeSnapshot(root: string, version: string, released: string[]): void {
  mkdirSync(join(root, "editors/vscode"), { recursive: true });
  for (const manifest of ["package.json", "editors/vscode/package.json"]) {
    writeFileSync(join(root, manifest), `${JSON.stringify({ version }, null, 2)}\n`);
  }
  writeFileSync(join(root, "CHANGELOG.md"), changelog({ unreleased: "", released }));
}

function git(root: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

function runCli(
  root: string,
  labels: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", resolve(import.meta.dir, "release-label.ts"), root],
    cwd: root,
    env: { ...process.env, PR_LABELS: JSON.stringify(labels), BASE_REF: "base" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}
