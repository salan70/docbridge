import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  bumpReleaseVersion,
  nextVersion,
  setReleaseVersion,
  versionedManifestPaths,
} from "./set-release-version";

describe("nextVersion", () => {
  test("increments the patch segment for a patch bump", () => {
    expect(nextVersion("0.6.1", "patch")).toBe("0.6.2");
  });

  test("increments the minor segment and resets patch for a minor bump", () => {
    expect(nextVersion("0.6.1", "minor")).toBe("0.7.0");
  });

  test("increments the major segment and resets minor and patch for a major bump", () => {
    expect(nextVersion("0.6.1", "major")).toBe("1.0.0");
  });

  test("rejects a current version that is not X.Y.Z", () => {
    expect(() => nextVersion("0.6", "patch")).toThrow("0.6 is not a X.Y.Z semantic version");
  });
});

describe("setReleaseVersion", () => {
  test("writes the same version into every versioned manifest", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.4.1" });

    setReleaseVersion(root, "0.7.0");

    expect(readVersion(root, "package.json")).toBe("0.7.0");
    expect(readVersion(root, "editors/vscode/package.json")).toBe("0.7.0");
  });

  test("reports every manifest it updated", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.4.1" });

    expect(setReleaseVersion(root, "0.7.0")).toEqual(versionedManifestPaths);
  });

  test("keeps manifest key order and two-space JSON formatting", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.6.1" });

    setReleaseVersion(root, "0.7.0");

    expect(readFileSync(join(root, "editors/vscode/package.json"), "utf8")).toBe(
      '{\n  "name": "docbridge",\n  "version": "0.7.0",\n  "publisher": "salan70"\n}\n',
    );
  });

  test("rejects a version that is not X.Y.Z", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.6.1" });

    expect(() => setReleaseVersion(root, "v0.7.0")).toThrow(
      "v0.7.0 is not a X.Y.Z semantic version",
    );
    expect(readVersion(root, "package.json")).toBe("0.6.1");
  });

  test("rejects a manifest that has no version field", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.6.1" });
    writeFileSync(join(root, "editors/vscode/package.json"), '{\n  "name": "docbridge"\n}\n');

    expect(() => setReleaseVersion(root, "0.7.0")).toThrow(
      "editors/vscode/package.json has no version field",
    );
    expect(readVersion(root, "package.json")).toBe("0.6.1");
  });
});

describe("bumpReleaseVersion", () => {
  test("bumps from the root manifest version and realigns a drifted extension manifest", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.4.1" });

    expect(bumpReleaseVersion(root, "minor")).toBe("0.7.0");
    expect(readVersion(root, "package.json")).toBe("0.7.0");
    expect(readVersion(root, "editors/vscode/package.json")).toBe("0.7.0");
  });
});

describe("set-release-version CLI", () => {
  test("prints the bumped version so the release workflow can capture it", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.6.1" });

    const result = runCli(["patch", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.6.2\n");
    expect(readVersion(root, "editors/vscode/package.json")).toBe("0.6.2");
  });

  test("rejects an unknown bump instead of writing manifests", () => {
    const root = createManifestFixture({ rootVersion: "0.6.1", extensionVersion: "0.6.1" });

    const result = runCli(["prerelease", root]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: bun run scripts/set-release-version.ts <major|minor|patch> [root]",
    );
    expect(readVersion(root, "package.json")).toBe("0.6.1");
  });
});

describe("release preparation", () => {
  test("keeps the committed manifests on one version", () => {
    const root = resolve(import.meta.dir, "..");

    expect(readVersion(root, "editors/vscode/package.json")).toBe(
      readVersion(root, "package.json"),
    );
  });

  test("bumps the release version through this script", () => {
    expect(releasePrepareWorkflow()).toContain("bun run scripts/set-release-version.ts");
  });

  test("stages every versioned manifest in the release commit", () => {
    const staged = stagedReleasePaths(releasePrepareWorkflow());

    for (const manifest of versionedManifestPaths) {
      expect(staged).toContain(manifest);
    }
  });
});

function releasePrepareWorkflow(): string {
  return readFileSync(resolve(import.meta.dir, "../.github/workflows/release-prepare.yml"), "utf8");
}

/** The paths the release commit stages, taken from the workflow's `git add`. */
function stagedReleasePaths(workflow: string): string[] {
  const paths = /^\s*git add (.+)$/m.exec(workflow)?.[1];
  if (paths === undefined) {
    throw new Error("release-prepare.yml has no `git add` step");
  }
  return paths.trim().split(/\s+/);
}

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/set-release-version.ts", ...args],
    cwd: resolve(import.meta.dir, ".."),
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

function createManifestFixture(versions: {
  rootVersion: string;
  extensionVersion: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), "docbridge-release-version-"));
  mkdirSync(join(root, "editors/vscode"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `{\n  "name": "docbridge",\n  "version": "${versions.rootVersion}",\n  "type": "module"\n}\n`,
  );
  writeFileSync(
    join(root, "editors/vscode/package.json"),
    `{\n  "name": "docbridge",\n  "version": "${versions.extensionVersion}",\n  "publisher": "salan70"\n}\n`,
  );
  return root;
}

function readVersion(root: string, relative: string): string {
  return (JSON.parse(readFileSync(join(root, relative), "utf8")) as { version: string }).version;
}
