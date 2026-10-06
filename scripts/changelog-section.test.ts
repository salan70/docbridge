import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { changelogSection, locateChangelogSection } from "./changelog-section";

const changelog = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "## [0.10.0] - 2026-10-01",
  "",
  "### Added",
  "",
  "- A feature.",
  "",
  "## [0.1.0] - 2026-09-01",
  "",
  "- The first release.",
  "",
  "[Unreleased]: https://github.com/o/r/compare/v0.10.0...HEAD",
  "[0.10.0]: https://github.com/o/r/releases/tag/v0.10.0",
  "",
].join("\n");

describe("locateChangelogSection", () => {
  test("ends a section at the next version heading", () => {
    expect(locateChangelogSection(changelog.split("\n"), "## [0.10.0]")).toEqual({
      start: 4,
      end: 10,
    });
  });

  test("ends the last section at the link references", () => {
    expect(locateChangelogSection(changelog.split("\n"), "## [0.1.0]")).toEqual({
      start: 10,
      end: 14,
    });
  });

  test("ends the last section at the end of a changelog without link references", () => {
    const lines = ["## [0.1.0] - 2026-09-01", "", "- The first release."];

    expect(locateChangelogSection(lines, "## [0.1.0]")).toEqual({ start: 0, end: 3 });
  });

  test("returns undefined for a missing heading", () => {
    expect(locateChangelogSection(changelog.split("\n"), "## [0.2.0]")).toBeUndefined();
  });

  test("matches the version literally, not as a pattern", () => {
    expect(locateChangelogSection(["## [0x1x0]", "- Other."], "## [0.1.0]")).toBeUndefined();
  });

  test("does not match a heading that only shares a version prefix", () => {
    expect(locateChangelogSection(changelog.split("\n"), "## [0.1]")).toBeUndefined();
  });

  test("does not end a section at a lower-level heading or an inline link", () => {
    const lines = ["## [0.1.0]", "### Added", "[docs](https://example.com): see", "## [0.0.1]"];

    expect(locateChangelogSection(lines, "## [0.1.0]")).toEqual({ start: 0, end: 3 });
  });
});

describe("changelogSection", () => {
  test("returns the body without surrounding blank lines", () => {
    expect(changelogSection(changelog, "## [0.10.0]")).toBe("### Added\n\n- A feature.");
  });

  test("returns an empty body for an empty section", () => {
    expect(changelogSection(changelog, "## [Unreleased]")).toBe("");
  });

  test("returns undefined for a missing section", () => {
    expect(changelogSection(changelog, "## [0.2.0]")).toBeUndefined();
  });
});

describe("release notes command", () => {
  test("prints the section of the given version", () => {
    const result = runCommand(changelog, "0.10.0");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("### Added\n\n- A feature.\n");
  });

  test("fails when the version has no section", () => {
    const result = runCommand(changelog, "0.2.0");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No changelog section found for 0.2.0");
  });

  test("fails when the section is empty", () => {
    const result = runCommand("## [0.2.0] - 2026-10-02\n\n## [0.1.0]\n\n- Old.\n", "0.2.0");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No changelog section found for 0.2.0");
  });
});

function runCommand(
  content: string,
  version: string,
): { exitCode: number; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "docbridge-changelog-section-"));
  try {
    writeFileSync(join(root, "CHANGELOG.md"), content);
    const result = Bun.spawnSync({
      cmd: ["bun", "run", resolve(import.meta.dir, "changelog-section.ts"), version],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
