#!/usr/bin/env bun

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  scannerPlatformKey,
  supportedScannerExecutableNames,
  supportedScannerPlatformKeys,
} from "../src/core/code-language";
import { documentUri, startLspSession, type LspSession } from "./lsp-client";

/**
 * Which machines the artifact has to run on.
 *
 * `release` ships to every supported platform, so it must carry every scanner
 * binary. `local` is installed into the editor on the machine that built it,
 * where cross-compiling the other platforms' scanners would cost far more than
 * the coverage is worth.
 */
export type PackageMode = "release" | "local";

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

type StartSession = (command: string[], cwd: string) => LspSession;

type VerifyOptions = {
  run?: Run;
  mode?: PackageMode;
  startSession?: StartSession;
};

const requiredServerCapabilities = ["hoverProvider", "definitionProvider", "referencesProvider"];

const repoRoot = resolve(import.meta.dir, "..");
const extensionRelativeRoot = "editors/vscode";
const iconRelativePath = "editors/vscode/assets/icon.png";
const activationEvents = [
  "workspaceContains:docbridge.config.json",
  "onLanguage:typescript",
  "onLanguage:typescriptreact",
  "onLanguage:swift",
  "onLanguage:dart",
  "onLanguage:rust",
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
      extensionPackage.description ?? "Language Server support for DocBridge documentation links.",
    version: rootPackage.version,
    icon: "assets/icon.png",
    repository: repositoryUrl ? { type: "git", url: repositoryUrl } : extensionPackage.repository,
    bugs: rootPackage.bugs ?? extensionPackage.bugs,
    homepage: rootPackage.homepage ?? extensionPackage.homepage,
    license: rootPackage.license ?? extensionPackage.license,
    keywords: rootPackage.keywords ?? extensionPackage.keywords,
    activationEvents,
    extensionKind: ["workspace"],
  };
}

export function requiredScannerPlatformKeys(
  mode: PackageMode,
  hostKey: string = scannerPlatformKey(),
): readonly string[] {
  if (mode === "release") {
    return supportedScannerPlatformKeys();
  }
  if (!supportedScannerPlatformKeys().includes(hostKey)) {
    throw new Error(
      `platform ${hostKey} is unsupported; supported platforms: ${supportedScannerPlatformKeys().join(", ")}`,
    );
  }
  return [hostKey];
}

export function assertPackagingInputs(
  root: string = repoRoot,
  mode: PackageMode = "release",
): void {
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

  // Fail here rather than let `packageVsix` trip over a missing `dist/bin` when
  // it preserves that tree across the rebuild: this message names the fix.
  assertRequiredScannerBinaries(join(root, "dist/bin"), mode, stagingHint);
}

export function defaultVsixPath(
  root: string = repoRoot,
  version?: string,
  mode: PackageMode = "release",
): string {
  const resolvedVersion = version ?? readJson<RootPackage>(join(root, "package.json")).version;
  const suffix = mode === "local" ? "-local" : "";
  return join(
    root,
    extensionRelativeRoot,
    ".tmp/out",
    `docbridge-${resolvedVersion}${suffix}.vsix`,
  );
}

/**
 * Bundles the CLI that ships inside the VSIX as `server/dist/index.js`. It is
 * the same Node-targeted bundle the npm package ships: the file keeps a
 * `#!/usr/bin/env node` shebang, `scripts/verify-dist.ts` executes it directly,
 * and Bun — which the extension launches it with — runs it just as well.
 */
export function serverBundleCommand(): string[] {
  return ["bun", "build", "src/cli/index.ts", "--outdir", "dist", "--target", "node"];
}

/**
 * Bundles the editor client so `vscode-languageclient` is inlined. vsce is
 * invoked with `--no-dependencies`, which does not pack `node_modules`.
 */
export function extensionBundleCommand(): string[] {
  return [
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
  ];
}

export function packageVsix(root: string = repoRoot, mode: PackageMode = "release"): string {
  assertPackagingInputs(root, mode);
  const rootPackage = readJson<RootPackage>(join(root, "package.json"));
  const extensionPackage = readJson<ExtensionPackage>(
    join(root, extensionRelativeRoot, "package.json"),
  );
  const extensionRoot = join(root, extensionRelativeRoot);
  const tmpRoot = join(extensionRoot, ".tmp");
  const preserveBin = join(tmpRoot, "preserved-dist-bin");
  const stageRoot = join(tmpRoot, "stage");
  const outDir = join(tmpRoot, "out");
  const outPath = defaultVsixPath(root, rootPackage.version, mode);

  rmSync(preserveBin, { recursive: true, force: true });
  mkdirSync(join(preserveBin, ".."), { recursive: true });
  cpSync(join(root, "dist/bin"), preserveBin, { recursive: true });

  run(["bun", "install", "--frozen-lockfile"], root);
  run(["bun", "install", "--frozen-lockfile"], extensionRoot);
  rmSync(join(root, "dist"), { recursive: true, force: true });
  run(serverBundleCommand(), root);
  chmodSync(join(root, "dist/index.js"), 0o755);
  cpSync(preserveBin, join(root, "dist/bin"), { recursive: true });
  run(["bun", "run", "scripts/verify-dist.ts"], root);
  run(["bun", "run", "compile"], extensionRoot);
  run(extensionBundleCommand(), extensionRoot);

  rmSync(stageRoot, { recursive: true, force: true });
  // Only this mode's artifact: release and local builds share `out/`, and
  // rebuilding one must not delete the other.
  rmSync(outPath, { force: true });
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  stageExtension(root, stageRoot, rootPackage, extensionPackage);
  run(["bunx", "@vscode/vsce", "package", "--no-dependencies", "--out", outPath], stageRoot);
  console.log(outPath);
  return outPath;
}

export async function verifyVsix(vsixPath?: string, mode: PackageMode = "release"): Promise<void> {
  const resolvedVsix = resolve(vsixPath ?? defaultVsixPath(repoRoot, undefined, mode));
  if (!existsSync(resolvedVsix)) {
    const recipe = mode === "local" ? "just package-vsix-local" : "just package-vsix";
    throw new Error(`${resolvedVsix} does not exist. Run \`${recipe}\` first.`);
  }
  // Expanding outside the checkout is the point: the packaged server has to
  // start with no repository `node_modules` and no repository `schemas/`
  // reachable from it.
  const tempRoot = mkdtempSync(join(tmpdir(), "docbridge-vsix-verify-"));
  try {
    run(["unzip", "-q", resolvedVsix, "-d", tempRoot], process.cwd());
    await verifyExpandedVsix(tempRoot, { mode });
    console.log(`Verified ${basename(resolvedVsix)}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function verifyExpandedVsix(
  expandedRoot: string,
  options: VerifyOptions = {},
): Promise<void> {
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
  assertLanguageClient(extensionRoot);
  assertFile(extensionRoot, "server/package.json");
  assertFile(extensionRoot, "server/README.md");
  assertFile(extensionRoot, "server/CHANGELOG.md");
  assertFile(extensionRoot, "server/LICENSE");
  assertExecutable(join(extensionRoot, "server/dist/index.js"));
  assertRequiredScannerBinaries(join(extensionRoot, "server/dist/bin"), options.mode ?? "release");
  assertDirectory(extensionRoot, "server/templates/skills");
  // The bundle inlines the two schemas it validates against, but `docbridge
  // init` writes `"$schema": "./schemas/docbridge.schema.json"` into generated
  // configs, so that file has to reach the installation.
  assertFile(extensionRoot, "server/schemas/docbridge.schema.json");
  assertNoSourceTree(extensionRoot);

  writeTypeScriptFixture(extensionRoot);
  const runCommand = options.run ?? run;
  runCommand(["bun", "server/dist/index.js", "--version"], extensionRoot);
  runCommand(["bun", "server/dist/index.js", "--help"], extensionRoot);
  runCommand(["bun", "server/dist/index.js", "check", "--root", ".verify-fixture"], extensionRoot);
  await verifyPackagedLanguageServer(extensionRoot, options.startSession ?? startLspSession);
}

/**
 * The extension's only job is to launch `docbridge lsp` from the bundle, so the
 * packaged artifact is only proven once that server initializes and answers
 * across a linked TypeScript/Markdown pair.
 */
async function verifyPackagedLanguageServer(
  extensionRoot: string,
  startSession: StartSession,
): Promise<void> {
  const fixtureRoot = join(extensionRoot, ".verify-fixture");
  const session = startSession(["bun", "server/dist/index.js", "lsp"], extensionRoot);

  try {
    await session.initialize(fixtureRoot);
    const capabilities = session.capabilities();
    for (const capability of requiredServerCapabilities) {
      if (capabilities[capability] !== true) {
        throw new Error(`packaged language server must advertise ${capability}.`);
      }
    }

    const authUri = documentUri(join(fixtureRoot, "src/auth.ts"));
    session.openDocument(
      authUri,
      "typescript",
      readFileSync(join(fixtureRoot, "src/auth.ts"), "utf8"),
    );
    const position = { line: 3, character: 18 };
    const hover = await session.request<{ contents?: { value?: string } } | null>(
      "textDocument/hover",
      { textDocument: { uri: authUri }, position },
    );
    if (!hover?.contents?.value?.includes("Auth Service")) {
      throw new Error("packaged language server did not hover the linked Markdown section.");
    }

    const definition = await session.request<{ uri?: string } | { uri?: string }[] | null>(
      "textDocument/definition",
      { textDocument: { uri: authUri }, position },
    );
    const location = Array.isArray(definition) ? definition[0] : definition;
    if (location?.uri?.endsWith("docs/auth.md") !== true) {
      throw new Error("packaged language server did not resolve the link to its Markdown file.");
    }

    // An unsaved buffer, so `check --root .verify-fixture` above stays clean.
    const brokenUri = documentUri(join(fixtureRoot, "src/broken.ts"));
    session.openDocument(
      brokenUri,
      "typescript",
      "/**\n * @doc docs/does-not-exist.md#nope\n */\nexport function broken() {}\n",
    );
    if ((await session.waitForDiagnostics(brokenUri)).length === 0) {
      throw new Error("packaged language server published no diagnostic for a broken link.");
    }
  } finally {
    await session.stop();
  }
}

export function publishVscodeExtension(vsixPath: string = defaultVsixPath(repoRoot)): void {
  const token = process.env.VSCE_PAT;
  if (token === undefined || token.trim() === "") {
    throw new Error("VSCE_PAT is required to publish to VS Code Marketplace.");
  }
  run(vscodeMarketplacePublishCommand(resolve(vsixPath), token), repoRoot);
}

export function vscodeMarketplacePublishCommand(vsixPath: string, token: string): string[] {
  return ["bunx", "@vscode/vsce", "publish", "--packagePath", vsixPath, "-p", token];
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

  const serverRoot = join(stageRoot, "server");
  copyPath(join(root, "package.json"), join(serverRoot, "package.json"));
  copyPath(join(root, "README.md"), join(serverRoot, "README.md"));
  copyPath(join(root, "CHANGELOG.md"), join(serverRoot, "CHANGELOG.md"));
  copyPath(join(root, "LICENSE"), join(serverRoot, "LICENSE"));
  copyPath(join(root, "dist"), join(serverRoot, "dist"));
  copyPath(join(root, "schemas"), join(serverRoot, "schemas"));
  copyPath(join(root, "templates/skills"), join(serverRoot, "templates/skills"));
}

const stagingHint = "Build the scanners, then run `just stage-scanner-binaries`.";

function assertRequiredScannerBinaries(
  binRoot: string,
  mode: PackageMode = "release",
  hint = "",
): void {
  const suffix = hint === "" ? "" : ` ${hint}`;
  for (const platform of requiredScannerPlatformKeys(mode)) {
    for (const executable of supportedScannerExecutableNames()) {
      const scannerPath = join(binRoot, platform, executable);
      if (!existsSync(scannerPath)) {
        throw new Error(`${relativePath(process.cwd(), scannerPath)} is required.${suffix}`);
      }
      assertExecutable(scannerPath);
    }
  }
}

/**
 * The VSIX ships a bundle, never a source tree. A raw `server/src` arrives
 * without `ajv` or the schema JSON its static imports need, so the language
 * server cannot start; test sources are dead weight in a published artifact.
 */
function assertNoSourceTree(extensionRoot: string): void {
  if (existsSync(join(extensionRoot, "server/src"))) {
    throw new Error("server/src must not be packaged in the VSIX.");
  }

  for (const entry of readdirSync(extensionRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      continue;
    }
    const relative = relativePath(extensionRoot, join(entry.parentPath, entry.name));
    throw new Error(`${relative} must not be packaged in the VSIX.`);
  }
}

function assertLanguageClient(extensionRoot: string): void {
  const extensionJs = join(extensionRoot, "out/extension.js");
  try {
    createRequire(extensionJs).resolve("vscode-languageclient/node");
  } catch {
    const source = readFileSync(extensionJs, "utf8");
    if (/\brequire\(\s*["']vscode-languageclient\/node["']\s*\)/.test(source)) {
      throw new Error("vscode-languageclient/node is required in the VSIX.");
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
    "Usage: bun run scripts/vscode-extension.ts <package|verify|publish-vscode> [--local] [vsix]",
  );
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    const mode: PackageMode = args.includes("--local") ? "local" : "release";
    const [command, maybeVsix] = args.filter((arg) => arg !== "--local");
    if (command === "package") {
      packageVsix(repoRoot, mode);
    } else if (command === "verify") {
      await verifyVsix(maybeVsix, mode);
    } else if (command === "publish-vscode") {
      publishVscodeExtension(maybeVsix);
    } else {
      usage();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
