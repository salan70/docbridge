import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertReleaseInputs,
  buildReleaseManifest,
  defaultVsixPath,
  verifyExpandedVsix,
  vscodeMarketplacePublishCommand,
} from "./vscode-extension";

describe("buildReleaseManifest", () => {
  test("uses the public extension identity and root package version", () => {
    const manifest = buildReleaseManifest(
      {
        version: "1.2.3",
        repository: { type: "git", url: "git+https://github.com/salan70/docbridge.git" },
        bugs: { url: "https://github.com/salan70/docbridge/issues" },
        homepage: "https://github.com/salan70/docbridge#readme",
        license: "MIT",
        keywords: ["documentation", "markdown", "lsp"],
      },
      {
        name: "docbridge",
        displayName: "DocBridge",
        description: "DocBridge editor support.",
        version: "1.2.3",
        publisher: "salan70",
        engines: { vscode: "^1.84.0" },
        categories: ["Programming Languages"],
        activationEvents: [],
        main: "./out/extension.js",
        contributes: { configuration: { title: "DocBridge", properties: {} } },
        dependencies: { "vscode-languageclient": "^9.0.1" },
      },
    );

    expect(manifest.name).toBe("docbridge");
    expect(manifest.publisher).toBe("salan70");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.icon).toBe("assets/icon.png");
    expect(manifest.activationEvents).toEqual([
      "workspaceContains:docbridge.config.json",
      "onLanguage:typescript",
      "onLanguage:typescriptreact",
      "onLanguage:swift",
      "onLanguage:dart",
      "onLanguage:markdown",
    ]);
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/salan70/docbridge.git",
    });
  });
});

describe("assertReleaseInputs", () => {
  test("rejects a missing extension icon", () => {
    const root = createReleaseInputFixture({ icon: false });

    expect(() => assertReleaseInputs(root)).toThrow("editors/vscode/assets/icon.png is required");
  });

  test("rejects extension and root version drift", () => {
    const root = createReleaseInputFixture({ editorVersion: "1.2.4" });

    expect(() => assertReleaseInputs(root)).toThrow(
      "editors/vscode/package.json version 1.2.4 must match root package.json version 1.2.3",
    );
  });

  test("requires every supported scanner binary to be staged", () => {
    const root = createReleaseInputFixture({ omitScanner: "linux-x64/speclink_dart_scanner" });

    expect(() => assertReleaseInputs(root)).toThrow(
      "dist/bin/linux-x64/speclink_dart_scanner is required",
    );
  });
});

describe("verifyExpandedVsix", () => {
  test("validates package contents and smokes the bundled CLI", () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    const commands: string[][] = [];

    verifyExpandedVsix(expandedRoot, {
      run(command) {
        commands.push(command);
      },
    });

    expect(commands).toEqual([
      ["bun", "server/dist/index.js", "--version"],
      ["bun", "server/dist/index.js", "--help"],
      ["bun", "server/dist/index.js", "check", "--root", ".verify-fixture"],
    ]);
  });
});

describe("defaultVsixPath", () => {
  test("places release VSIX output under editors/vscode/.tmp/out", () => {
    expect(defaultVsixPath("/repo", "1.2.3")).toBe(
      "/repo/editors/vscode/.tmp/out/docbridge-1.2.3.vsix",
    );
  });
});

describe("publish command builders", () => {
  test("publishes an existing VSIX to VS Code Marketplace with VSCE_PAT", () => {
    expect(vscodeMarketplacePublishCommand("/tmp/docbridge.vsix", "secret")).toEqual([
      "bunx",
      "@vscode/vsce",
      "publish",
      "--packagePath",
      "/tmp/docbridge.vsix",
      "-p",
      "secret",
    ]);
  });
});

test("rejects Open VSX as an unsupported publish target", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/vscode-extension.ts", "publish-open-vsx"],
    cwd: resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(1);
  expect(new TextDecoder().decode(result.stderr)).toContain(
    "Usage: bun run scripts/vscode-extension.ts <package|verify|publish-vscode> [vsix]",
  );
});

function createReleaseInputFixture(
  options: {
    icon?: boolean;
    editorVersion?: string;
    omitScanner?: string;
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "docbridge-vsix-input-"));
  mkdirSync(join(root, "editors/vscode/assets"), { recursive: true });
  mkdirSync(join(root, "dist/bin"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      version: "1.2.3",
      repository: { type: "git", url: "git+https://github.com/salan70/docbridge.git" },
      bugs: { url: "https://github.com/salan70/docbridge/issues" },
      homepage: "https://github.com/salan70/docbridge#readme",
      license: "MIT",
      keywords: ["documentation"],
    }),
  );
  writeFileSync(
    join(root, "editors/vscode/package.json"),
    JSON.stringify({
      name: "docbridge",
      version: options.editorVersion ?? "1.2.3",
      publisher: "salan70",
    }),
  );
  if (options.icon !== false) {
    writeFileSync(join(root, "editors/vscode/assets/icon.png"), "png");
  }
  for (const platform of ["darwin-arm64", "linux-x64"]) {
    for (const executable of ["speclink-swift-scanner", "speclink_dart_scanner"]) {
      const relative = `${platform}/${executable}`;
      if (relative === options.omitScanner) {
        continue;
      }
      const file = join(root, "dist/bin", platform, executable);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "binary");
      chmodSync(file, 0o755);
    }
  }
  return root;
}

function createExpandedVsixFixture(extensionRoot: string): void {
  mkdirSync(join(extensionRoot, "assets"), { recursive: true });
  mkdirSync(join(extensionRoot, "out"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/dist/bin"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/schemas"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/templates/skills"), { recursive: true });
  writeFileSync(
    join(extensionRoot, "package.json"),
    JSON.stringify({
      name: "docbridge",
      publisher: "salan70",
      version: "1.2.3",
      icon: "assets/icon.png",
    }),
  );
  writeFileSync(join(extensionRoot, "assets/icon.png"), "png");
  writeFileSync(join(extensionRoot, "changelog.md"), "# Changelog\n");
  writeFileSync(join(extensionRoot, "LICENSE.txt"), "MIT\n");
  writeFileSync(join(extensionRoot, "out/extension.js"), "compiled");
  writeFileSync(join(extensionRoot, "server/package.json"), "{}");
  writeFileSync(join(extensionRoot, "server/README.md"), "# README\n");
  writeFileSync(join(extensionRoot, "server/CHANGELOG.md"), "# Changelog\n");
  writeFileSync(join(extensionRoot, "server/LICENSE"), "MIT\n");
  writeFileSync(join(extensionRoot, "server/dist/index.js"), "#!/usr/bin/env bun\n");
  chmodSync(join(extensionRoot, "server/dist/index.js"), 0o755);
  for (const platform of ["darwin-arm64", "linux-x64"]) {
    for (const executable of ["speclink-swift-scanner", "speclink_dart_scanner"]) {
      const file = join(extensionRoot, "server/dist/bin", platform, executable);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "binary");
      chmodSync(file, 0o755);
    }
  }
}
