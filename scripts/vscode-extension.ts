#!/usr/bin/env bun

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type RootPackage = {
  version: string;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  homepage?: string;
  license?: string;
  keywords?: string[];
};

type ExtensionPackage = JsonObject & {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  publisher: string;
  engines?: JsonObject;
  categories?: string[];
  activationEvents?: string[];
  main?: string;
  contributes?: JsonObject;
  dependencies?: Record<string, string>;
};

type Run = (command: string[], cwd: string) => void;

type VerifyOptions = {
  run?: Run;
};

const repoRoot = resolve(import.meta.dir, "..");
const extensionRelativeRoot = "editors/vscode";
const iconRelativePath = "editors/vscode/assets/icon.png";
const requiredScannerPlatforms = ["darwin-arm64", "linux-x64"] as const;
const scannerExecutableNames = [
  "speclink-swift-scanner",
  "speclink_dart_scanner",
] as const;
const activationEvents = [
  "workspaceContains:docbridge.config.json",
  "onLanguage:typescript",
  "onLanguage:typescriptreact",
  "onLanguage:swift",
  "onLanguage:dart",
  "onLanguage:markdown",
];

export function buildReleaseManifest(
  rootPackage: RootPackage,
  extensionPackage: ExtensionPackage,
): ExtensionPackage {
  const repositoryUrl = normalizeRepositoryUrl(rootPackage.repository?.url);
  return {
    ...extensionPackage,
    name: "docbridge",
    publisher: "salan70",
    displayName: "DocBridge",
    description:
      extensionPackage.description ??
      "Language Server support for DocBridge documentation links.",
    version: rootPackage.version,
    icon: "assets/icon.png",
    repository: repositoryUrl
      ? { type: "git", url: repositoryUrl }
      : extensionPackage.repository,
    bugs: rootPackage.bugs ?? extensionPackage.bugs,
    homepage: rootPackage.homepage ?? extensionPackage.homepage,
    license: rootPackage.license ?? extensionPackage.license,
    keywords: rootPackage.keywords ?? extensionPackage.keywords,
    activationEvents,
    extensionKind: ["workspace"],
  };
}

export function assertReleaseInputs(root: string = repoRoot): void {
  const rootPackage = readJson<RootPackage>(join(root, "package.json"));
  const extensionPackage = readJson<ExtensionPackage>(
    join(root, extensionRelativeRoot, "package.json"),
  );

  if (!existsSync(join(root, iconRelativePath))) {
    throw new Error(`${iconRelativePath} is required before packaging the VSIX.`);
  }

  if (extensionPackage.version !== rootPackage.version) {
    throw new Error(
      `${extensionRelativeRoot}/package.json version ${extensionPackage.version} must match root package.json version ${rootPackage.version}`,
    );
  }

  assertRequiredScannerBinaries(join(root, "dist/bin"));
}

export function defaultVsixPath(root: string = repoRoot, version?: string): string {
  const resolvedVersion =
    version ?? readJson<RootPackage>(join(root, "package.json")).version;
  return join(root, extensionRelativeRoot, ".tmp/out", `docbridge-${resolvedVersion}.vsix`);
}

export function packageVsix(root: string = repoRoot): string {
  assertReleaseInputs(root);
  const rootPackage = readJson<RootPackage>(join(root, "package.json"));
  const extensionPackage = readJson<ExtensionPackage>(
    join(root, extensionRelativeRoot, "package.json"),
  );
  const extensionRoot = join(root, extensionRelativeRoot);
  const tmpRoot = join(extensionRoot, ".tmp");
  const preserveBin = join(tmpRoot, "preserved-dist-bin");
  const stageRoot = join(tmpRoot, "stage");
  const outDir = join(tmpRoot, "out");
  const outPath = defaultVsixPath(root, rootPackage.version);

  rmSync(preserveBin, { recursive: true, force: true });
  mkdirSync(join(preserveBin, ".."), { recursive: true });
  cpSync(join(root, "dist/bin"), preserveBin, { recursive: true });

  run(["bun", "install", "--frozen-lockfile"], root);
  run(["bun", "install", "--frozen-lockfile"], extensionRoot);
  rmSync(join(root, "dist"), { recursive: true, force: true });
  run(["bun", "build", "src/cli/index.ts", "--outdir", "dist", "--target", "bun"], root);
  chmodSync(join(root, "dist/index.js"), 0o755);
  cpSync(preserveBin, join(root, "dist/bin"), { recursive: true });
  run(["bun", "run", "scripts/verify-dist.ts"], root);
  run(["bun", "run", "compile"], extensionRoot);

  rmSync(stageRoot, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  stageExtension(root, stageRoot, rootPackage, extensionPackage);
  run(["bunx", "@vscode/vsce", "package", "--no-dependencies", "--out", outPath], stageRoot);
  console.log(outPath);
  return outPath;
}

export function verifyVsix(vsixPath: string = defaultVsixPath()): void {
  const resolvedVsix = resolve(vsixPath);
  if (!existsSync(resolvedVsix)) {
    throw new Error(`${resolvedVsix} does not exist. Run \`just package-vsix\` first.`);
  }
  const tempRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-verify-"));
  try {
    run(["unzip", "-q", resolvedVsix, "-d", tempRoot], process.cwd());
    verifyExpandedVsix(tempRoot);
    console.log(`Verified ${basename(resolvedVsix)}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function verifyExpandedVsix(
  expandedRoot: string,
  options: VerifyOptions = {},
): void {
  const extensionRoot = join(expandedRoot, "extension");
  const manifest = readJson<ExtensionPackage>(join(extensionRoot, "package.json"));

  if (manifest.name !== "docbridge" || manifest.publisher !== "salan70") {
    throw new Error("VSIX manifest must identify the extension as salan70.docbridge.");
  }

  assertFile(extensionRoot, "package.json");
  assertFile(extensionRoot, "changelog.md");
  assertFile(extensionRoot, "LICENSE.txt");
  assertFile(extensionRoot, "assets/icon.png");
  assertFile(extensionRoot, "out/extension.js");
  assertFile(extensionRoot, "server/package.json");
  assertFile(extensionRoot, "server/README.md");
  assertFile(extensionRoot, "server/CHANGELOG.md");
  assertFile(extensionRoot, "server/LICENSE");
  assertExecutable(join(extensionRoot, "server/dist/index.js"));
  assertRequiredScannerBinaries(join(extensionRoot, "server/dist/bin"));
  assertDirectory(extensionRoot, "server/schemas");
  assertDirectory(extensionRoot, "server/templates/skills");

  writeTypeScriptFixture(extensionRoot);
  const runCommand = options.run ?? run;
  runCommand(["bun", "server/dist/index.js", "--version"], extensionRoot);
  runCommand(["bun", "server/dist/index.js", "--help"], extensionRoot);
  runCommand(
    ["bun", "server/dist/index.js", "check", "--root", ".verify-fixture"],
    extensionRoot,
  );
}

export function publishVscodeExtension(
  vsixPath: string = defaultVsixPath(),
): void {
  const token = process.env.VSCE_PAT;
  if (token === undefined || token.trim() === "") {
    throw new Error("VSCE_PAT is required to publish to VS Code Marketplace.");
  }
  run(vscodeMarketplacePublishCommand(resolve(vsixPath), token), repoRoot);
}

export function publishOpenVsxExtension(
  vsixPath: string = defaultVsixPath(),
): void {
  const token = process.env.OVSX_PAT;
  if (token === undefined || token.trim() === "") {
    throw new Error("OVSX_PAT is required to publish to Open VSX.");
  }
  run(openVsxPublishCommand(resolve(vsixPath), token), repoRoot);
}

export function vscodeMarketplacePublishCommand(
  vsixPath: string,
  token: string,
): string[] {
  return [
    "bunx",
    "@vscode/vsce",
    "publish",
    "--packagePath",
    vsixPath,
    "-p",
    token,
  ];
}

export function openVsxPublishCommand(vsixPath: string, token: string): string[] {
  return ["bunx", "ovsx", "publish", vsixPath, "-p", token];
}

function stageExtension(
  root: string,
  stageRoot: string,
  rootPackage: RootPackage,
  extensionPackage: ExtensionPackage,
): void {
  const extensionRoot = join(root, extensionRelativeRoot);
  writeFileSync(
    join(stageRoot, "package.json"),
    `${JSON.stringify(buildReleaseManifest(rootPackage, extensionPackage), null, 2)}\n`,
  );
  copyPath(join(extensionRoot, "README.md"), join(stageRoot, "README.md"));
  copyPath(join(root, "CHANGELOG.md"), join(stageRoot, "CHANGELOG.md"));
  copyPath(join(root, "LICENSE"), join(stageRoot, "LICENSE"));
  copyPath(join(extensionRoot, "out"), join(stageRoot, "out"));
  copyPath(join(extensionRoot, "assets"), join(stageRoot, "assets"));
  copyPath(join(extensionRoot, "node_modules"), join(stageRoot, "node_modules"));

  const serverRoot = join(stageRoot, "server");
  copyPath(join(root, "package.json"), join(serverRoot, "package.json"));
  copyPath(join(root, "README.md"), join(serverRoot, "README.md"));
  copyPath(join(root, "CHANGELOG.md"), join(serverRoot, "CHANGELOG.md"));
  copyPath(join(root, "LICENSE"), join(serverRoot, "LICENSE"));
  copyPath(join(root, "dist"), join(serverRoot, "dist"));
  copyPath(join(root, "schemas"), join(serverRoot, "schemas"));
  copyPath(join(root, "templates/skills"), join(serverRoot, "templates/skills"));
}

function assertRequiredScannerBinaries(binRoot: string): void {
  for (const platform of requiredScannerPlatforms) {
    for (const executable of scannerExecutableNames) {
      const scannerPath = join(binRoot, platform, executable);
      if (!existsSync(scannerPath)) {
        throw new Error(`${relativePath(process.cwd(), scannerPath)} is required.`);
      }
      assertExecutable(scannerPath);
    }
  }
}

function assertFile(root: string, relative: string): void {
  const path = join(root, relative);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${relative} is required in the VSIX.`);
  }
}

function assertDirectory(root: string, relative: string): void {
  const path = join(root, relative);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${relative} is required in the VSIX.`);
  }
}

function assertExecutable(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`${relativePath(process.cwd(), path)} is required.`);
  }
  if ((statSync(path).mode & 0o111) === 0) {
    throw new Error(`${relativePath(process.cwd(), path)} is not executable.`);
  }
}

function writeTypeScriptFixture(extensionRoot: string): void {
  const fixtureRoot = join(extensionRoot, ".verify-fixture");
  mkdirSync(join(fixtureRoot, "src"), { recursive: true });
  mkdirSync(join(fixtureRoot, "docs"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, "docbridge.config.json"),
    JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  writeFileSync(
    join(fixtureRoot, "src/auth.ts"),
    "/**\n * @doc docs/auth.md#auth-service\n */\nexport function authService() {}\n",
  );
  writeFileSync(
    join(fixtureRoot, "docs/auth.md"),
    "<!-- @code src/auth.ts#authService -->\n## Auth Service\n",
  );
}

function copyPath(source: string, destination: string): void {
  mkdirSync(join(destination, ".."), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeRepositoryUrl(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  return url.replace(/^git\+/, "");
}

function relativePath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath.startsWith(`${resolvedRoot}/`)
    ? resolvedPath.slice(resolvedRoot.length + 1)
    : resolvedPath;
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(new TextDecoder().decode(result.stdout));
    console.error(new TextDecoder().decode(result.stderr));
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

function usage(): never {
  throw new Error(
    "Usage: bun run scripts/vscode-extension.ts <package|verify|publish-vscode|publish-open-vsx> [vsix]",
  );
}

if (import.meta.main) {
  try {
    const [command, maybeVsix] = Bun.argv.slice(2);
    if (command === "package") {
      packageVsix();
    } else if (command === "verify") {
      verifyVsix(maybeVsix);
    } else if (command === "publish-vscode") {
      publishVscodeExtension(maybeVsix);
    } else if (command === "publish-open-vsx") {
      publishOpenVsxExtension(maybeVsix);
    } else {
      usage();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
