import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  supportedScannerExecutableNames,
  supportedScannerPlatformKeys,
  scannerPlatformKey,
} from "../src/core/code-language";
import type { LspSession } from "./lsp-client";
import {
  assertPackagingInputs,
  buildReleaseManifest,
  defaultVsixPath,
  extensionBundleCommand,
  requiredScannerPlatformKeys,
  serverBundleCommand,
  verifyExpandedVsix,
  vscodeMarketplacePublishCommand,
} from "./vscode-extension";

const hostPlatformKey = scannerPlatformKey();

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
      "onLanguage:rust",
      "onLanguage:markdown",
    ]);
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/salan70/docbridge.git",
    });
  });
});

describe("requiredScannerPlatformKeys", () => {
  test("a release artifact must carry every supported platform", () => {
    expect(requiredScannerPlatformKeys("release")).toEqual([...supportedScannerPlatformKeys()]);
  });

  test("a local artifact only has to run on the machine that built it", () => {
    expect(requiredScannerPlatformKeys("local", "linux-x64")).toEqual(["linux-x64"]);
  });

  test("rejects a local build on a platform DocBridge ships no scanners for", () => {
    expect(() => requiredScannerPlatformKeys("local", "win32-x64")).toThrow(
      "platform win32-x64 is unsupported; supported platforms: darwin-arm64, linux-x64",
    );
  });
});

describe("assertPackagingInputs", () => {
  test("rejects a missing extension icon", () => {
    const root = createPackagingInputFixture({ icon: false });

    expect(() => assertPackagingInputs(root)).toThrow("editors/vscode/assets/icon.png is required");
  });

  test("rejects extension and root version drift", () => {
    const root = createPackagingInputFixture({ editorVersion: "1.2.4" });

    expect(() => assertPackagingInputs(root)).toThrow(
      "editors/vscode/package.json version 1.2.4 must match root package.json version 1.2.3",
    );
  });

  test("requires every supported scanner binary for a release artifact", () => {
    const root = createPackagingInputFixture({ omitScanner: "linux-x64/docbridge_dart_scanner" });

    expect(() => assertPackagingInputs(root, "release")).toThrow(
      "dist/bin/linux-x64/docbridge_dart_scanner is required",
    );
  });

  test("accepts host-only scanners for a local artifact", () => {
    const root = createPackagingInputFixture({ platforms: [hostPlatformKey] });

    expect(() => assertPackagingInputs(root, "local")).not.toThrow();
  });

  test("names the staging prerequisite when a local artifact has no host scanner", () => {
    const root = createPackagingInputFixture({
      platforms: [hostPlatformKey],
      omitScanner: `${hostPlatformKey}/docbridge-swift-scanner`,
    });

    expect(() => assertPackagingInputs(root, "local")).toThrow(
      `dist/bin/${hostPlatformKey}/docbridge-swift-scanner is required. Build the scanners, then run \`just stage-scanner-binaries\`.`,
    );
  });
});

describe("verifyExpandedVsix", () => {
  test("validates package contents and smokes the bundled CLI", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    const commands: string[][] = [];

    await verifyExpandedVsix(expandedRoot, {
      run(command) {
        commands.push(command);
      },
      startSession: fakeSession,
    });

    expect(commands).toEqual([
      ["bun", "server/dist/index.js", "--version"],
      ["bun", "server/dist/index.js", "--help"],
      ["bun", "server/dist/index.js", "check", "--root", ".verify-fixture"],
    ]);
  });

  test("launches the language server from the packaged bundle, not the checkout", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    const launches: Array<{ command: string[]; cwd: string }> = [];

    await verifyExpandedVsix(expandedRoot, {
      run() {},
      startSession(command, cwd) {
        launches.push({ command, cwd });
        return createFakeSession();
      },
    });

    expect(launches).toEqual([
      { command: ["bun", "server/dist/index.js", "lsp"], cwd: extensionRoot },
    ]);
  });

  test("rejects a packaged server that does not advertise a capability the client binds to", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    createExpandedVsixFixture(join(expandedRoot, "extension"));

    await expect(
      verifyExpandedVsix(expandedRoot, {
        run() {},
        startSession: () => createFakeSession({ capabilities: { hoverProvider: true } }),
      }),
    ).rejects.toThrow("packaged language server must advertise definitionProvider.");
  });

  test("rejects a packaged server that cannot resolve a link in the fixture", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    createExpandedVsixFixture(join(expandedRoot, "extension"));

    await expect(
      verifyExpandedVsix(expandedRoot, {
        run() {},
        startSession: () => createFakeSession({ hover: null }),
      }),
    ).rejects.toThrow("packaged language server did not hover the linked Markdown section.");
  });

  test("rejects a packaged server that reports no diagnostic for a broken link", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    createExpandedVsixFixture(join(expandedRoot, "extension"));

    await expect(
      verifyExpandedVsix(expandedRoot, {
        run() {},
        startSession: () => createFakeSession({ diagnostics: [] }),
      }),
    ).rejects.toThrow("packaged language server published no diagnostic for a broken link.");
  });

  test("accepts host-only scanners in a local artifact", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot, { platforms: [hostPlatformKey] });

    await expect(
      verifyExpandedVsix(expandedRoot, { mode: "local", run() {}, startSession: fakeSession }),
    ).resolves.toBeUndefined();
  });

  test("rejects a local artifact that is missing the host platform's scanners", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot, { platforms: [] });

    await expect(
      verifyExpandedVsix(expandedRoot, { mode: "local", run() {}, startSession: fakeSession }),
    ).rejects.toThrow(`${hostPlatformKey}/docbridge-swift-scanner is required`);
  });

  test("rejects a raw server source tree, which ships without its dependencies", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    mkdirSync(join(extensionRoot, "server/src/cli"), { recursive: true });
    writeFileSync(join(extensionRoot, "server/src/cli/index.ts"), "export {};\n");

    await expect(
      verifyExpandedVsix(expandedRoot, { run() {}, startSession: fakeSession }),
    ).rejects.toThrow("server/src must not be packaged in the VSIX.");
  });

  test("rejects test sources copied into the artifact", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    writeFileSync(join(extensionRoot, "server/schemas/config.test.ts"), "export {};\n");

    await expect(
      verifyExpandedVsix(expandedRoot, { run() {}, startSession: fakeSession }),
    ).rejects.toThrow("server/schemas/config.test.ts must not be packaged in the VSIX.");
  });

  test("requires the config schema the generated $schema reference points at", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    rmSync(join(extensionRoot, "server/schemas/docbridge.schema.json"));

    await expect(
      verifyExpandedVsix(expandedRoot, { run() {}, startSession: fakeSession }),
    ).rejects.toThrow("server/schemas/docbridge.schema.json is required in the VSIX.");
  });

  test("rejects an extension that requires vscode-languageclient without shipping it", async () => {
    const expandedRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-expanded-"));
    const extensionRoot = join(expandedRoot, "extension");
    createExpandedVsixFixture(extensionRoot);
    writeFileSync(
      join(extensionRoot, "out/extension.js"),
      '"use strict";\nrequire("vscode-languageclient/node");\n',
    );

    await expect(
      verifyExpandedVsix(expandedRoot, { run() {}, startSession: fakeSession }),
    ).rejects.toThrow("vscode-languageclient/node is required in the VSIX");
  });
});

describe("defaultVsixPath", () => {
  test("places release VSIX output under editors/vscode/.tmp/out", () => {
    expect(defaultVsixPath("/repo", "1.2.3")).toBe(
      "/repo/editors/vscode/.tmp/out/docbridge-1.2.3.vsix",
    );
  });

  test("names a local artifact apart so it is never mistaken for a release build", () => {
    expect(defaultVsixPath("/repo", "1.2.3", "local")).toBe(
      "/repo/editors/vscode/.tmp/out/docbridge-1.2.3-local.vsix",
    );
  });
});

describe("serverBundleCommand", () => {
  test("bundles the VSIX server for Node, the runtime its shebang and verify-dist assume", () => {
    expect(serverBundleCommand()).toEqual([
      "bun",
      "build",
      "src/cli/index.ts",
      "--outdir",
      "dist",
      "--target",
      "node",
    ]);
  });
});

describe("extensionBundleCommand", () => {
  test("bundles the editor client for Node and leaves vscode to the editor host", () => {
    expect(extensionBundleCommand()).toEqual([
      "bun",
      "build",
      "src/extension.ts",
      "--outfile",
      "out/extension.js",
      "--target",
      "node",
      "--format",
      "cjs",
      "--external",
      "vscode",
    ]);
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
    "Usage: bun run scripts/vscode-extension.ts <package|verify|publish-vscode> [--local] [vsix]",
  );
});

/**
 * A language server that answers everything the packaged-artifact smoke asks
 * for. Each failure test overrides exactly one answer, so the assertion names
 * the contract that broke.
 */
function createFakeSession(
  overrides: {
    capabilities?: Record<string, unknown>;
    hover?: { contents?: { value?: string } } | null;
    definition?: { uri?: string } | null;
    diagnostics?: Record<string, unknown>[];
  } = {},
): LspSession {
  const capabilities = overrides.capabilities ?? {
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
  };
  const hover =
    overrides.hover === undefined ? { contents: { value: "## Auth Service" } } : overrides.hover;
  const definition =
    overrides.definition === undefined
      ? { uri: "file:///verify-fixture/docs/auth.md" }
      : overrides.definition;

  return {
    initialize: () => Promise.resolve(),
    capabilities: () => capabilities,
    request: <T>(method: string) =>
      Promise.resolve((method === "textDocument/hover" ? hover : definition) as T),
    notify() {},
    openDocument() {},
    diagnosticsFor: () => overrides.diagnostics ?? [{ message: "broken link" }],
    waitForDiagnostics: () =>
      Promise.resolve(overrides.diagnostics ?? [{ message: "broken link" }]),
    stop: () => Promise.resolve(),
  };
}

const fakeSession = (): LspSession => createFakeSession();

function createPackagingInputFixture(
  options: {
    icon?: boolean;
    editorVersion?: string;
    omitScanner?: string;
    platforms?: readonly string[];
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
  for (const platform of options.platforms ?? supportedScannerPlatformKeys()) {
    for (const executable of supportedScannerExecutableNames()) {
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

function createExpandedVsixFixture(
  extensionRoot: string,
  options: { platforms?: readonly string[] } = {},
): void {
  mkdirSync(join(extensionRoot, "assets"), { recursive: true });
  mkdirSync(join(extensionRoot, "out"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/dist/bin"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/schemas"), { recursive: true });
  mkdirSync(join(extensionRoot, "server/templates/skills"), { recursive: true });
  writeFileSync(join(extensionRoot, "server/schemas/docbridge.schema.json"), "{}");
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
  for (const platform of options.platforms ?? supportedScannerPlatformKeys()) {
    for (const executable of supportedScannerExecutableNames()) {
      const file = join(extensionRoot, "server/dist/bin", platform, executable);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "binary");
      chmodSync(file, 0o755);
    }
  }
}
