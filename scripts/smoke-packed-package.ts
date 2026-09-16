#!/usr/bin/env bun

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  supportedScannerExecutableNames,
  supportedScannerPlatformKeys,
} from "../src/core/scanner-executable";

// The packaged CLI must work for both npm/Node and Bun consumers.
const cliRuntimes = ["node", "bun"] as const;

const canonicalDocumentationNames = [
  "automation",
  "commands",
  "configuration",
  "getting-started",
  "linking",
  "troubleshooting",
] as const;

const legacyDocumentationNames = {
  annotations: "linking",
  "linking-workflow": "linking",
  "link-review": "linking",
  "agent-integration": "automation",
} as const;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SmokeOptions = {
  scannerFixtures: boolean;
};

export function smokePackedPackage(
  tarball: string,
  options: SmokeOptions = { scannerFixtures: true },
): void {
  const tarballPath = resolve(tarball);
  const tempRoot = mkdtempSync(join(tmpdir(), "docbridge-pack-smoke-"));

  try {
    installAndSmoke(tarballPath, tempRoot, options);
    if (options.scannerFixtures) {
      smokeExecutableBitRepair(tarballPath, tempRoot);
    }
    console.log(`Smoke-tested ${basename(tarballPath)} in ${tempRoot}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Regression coverage for issue #74: bundled scanners arrive non-executable.
 *
 * `npm install` preserves tarball modes, so the root above never reproduced the
 * defect. `bun install` is the installer downstream adopters use and the one
 * that drops the bit, so install that way as well. The bit is then stripped
 * explicitly before every check so the repair path stays covered even if a
 * future Bun release stops dropping it.
 */
function smokeExecutableBitRepair(tarballPath: string, tempRoot: string): void {
  const installRoot = join(tempRoot, "bun-install");
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({ private: true, dependencies: {} }, null, 2),
  );
  run(["bun", "install", tarballPath], installRoot);
  reportInstalledScannerModes(installRoot);

  writeScannerFixtures(installRoot);
  for (const runtime of cliRuntimes) {
    for (const fixture of ["swift-fixture", "dart-fixture", "rust-fixture"] as const) {
      stripInstalledScannerExecutableBits(installRoot);
      run(
        [
          runtime,
          join(installRoot, "node_modules/.bin/docbridge"),
          "check",
          "--root",
          join(installRoot, fixture),
        ],
        installRoot,
      );
    }
  }
}

/**
 * Report, never gate: the bit being absent after `bun install` is the
 * installer's behavior, not a DocBridge regression. The gate is that
 * `docbridge check` succeeds anyway.
 */
function reportInstalledScannerModes(installRoot: string): void {
  for (const scannerPath of installedScannerPaths(installRoot)) {
    const mode = statSync(scannerPath).mode & 0o7777;
    console.log(
      `${relativeToRoot(installRoot, scannerPath)} installed with mode 0${mode.toString(8)}`,
    );
  }
}

function stripInstalledScannerExecutableBits(installRoot: string): void {
  for (const scannerPath of installedScannerPaths(installRoot)) {
    chmodSync(scannerPath, statSync(scannerPath).mode & ~0o111);
  }
}

function installedScannerPaths(installRoot: string): string[] {
  const paths: string[] = [];
  for (const platform of supportedScannerPlatformKeys()) {
    for (const executable of supportedScannerExecutableNames()) {
      const scannerPath = join(
        installRoot,
        "node_modules/docbridge/dist/bin",
        platform,
        executable,
      );
      if (existsSync(scannerPath)) {
        paths.push(scannerPath);
      }
    }
  }
  return paths;
}

export function assertInstalledScannerExecutables(installRoot: string): void {
  for (const scannerPath of installedScannerPaths(installRoot)) {
    if ((statSync(scannerPath).mode & 0o111) === 0) {
      throw new Error(`${relativeToRoot(installRoot, scannerPath)} is not executable.`);
    }
  }
}

function installAndSmoke(tarballPath: string, tempRoot: string, options: SmokeOptions): void {
  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ private: true, dependencies: {} }, null, 2),
  );
  run(["npm", "install", tarballPath], tempRoot);
  assertInstalledScannerExecutables(tempRoot);
  for (const runtime of cliRuntimes) {
    run([runtime, "node_modules/.bin/docbridge", "--version"], tempRoot);
    run([runtime, "node_modules/.bin/docbridge", "--help"], tempRoot);
    assertDocumentationCommands((args) =>
      runResult([runtime, "node_modules/.bin/docbridge", ...args], tempRoot),
    );

    const upgradeFixture = join(tempRoot, `upgrade-fixture-${runtime}`);
    mkdirSync(join(upgradeFixture, ".claude/skills/docbridge-adopt"), { recursive: true });
    assertUpgradeCommand({
      execute: (args) => runResult([runtime, "node_modules/.bin/docbridge", ...args], tempRoot),
      fixtureRoot: upgradeFixture,
    });
  }

  mkdirSync(join(tempRoot, "fixture/src"), { recursive: true });
  mkdirSync(join(tempRoot, "fixture/docs"), { recursive: true });
  writeFileSync(
    join(tempRoot, "fixture/docbridge.config.json"),
    JSON.stringify({
      include: {
        code: { typescript: { patterns: ["src/**/*.ts"] } },
        docs: ["docs/**/*.md"],
      },
    }),
  );
  writeFileSync(
    join(tempRoot, "fixture/src/auth.ts"),
    "/**\n * @doc docs/auth.md#auth-service\n */\nexport function authService() {}\n",
  );
  writeFileSync(
    join(tempRoot, "fixture/docs/auth.md"),
    "<!-- @code src/auth.ts#authService -->\n## Auth Service\n",
  );
  for (const runtime of cliRuntimes) {
    run(
      [
        runtime,
        join(tempRoot, "node_modules/.bin/docbridge"),
        "check",
        "--root",
        join(tempRoot, "fixture"),
      ],
      tempRoot,
    );
  }

  if (!options.scannerFixtures) {
    return;
  }

  writeScannerFixtures(tempRoot);
  for (const runtime of cliRuntimes) {
    for (const fixture of ["swift-fixture", "dart-fixture", "rust-fixture"] as const) {
      run(
        [
          runtime,
          join(tempRoot, "node_modules/.bin/docbridge"),
          "check",
          "--root",
          join(tempRoot, fixture),
        ],
        tempRoot,
      );
    }
  }
}

function writeScannerFixtures(root: string): void {
  mkdirSync(join(root, "swift-fixture/Sources"), { recursive: true });
  mkdirSync(join(root, "swift-fixture/docs"), { recursive: true });
  writeFixtureConfig(root, "swift-fixture", {
    swift: { patterns: ["Sources/**/*.swift"] },
  });
  writeFileSync(
    join(root, "swift-fixture/Sources/AuthService.swift"),
    "/// @doc docs/auth.md#auth-service\npublic struct AuthService {}\n",
  );
  writeFileSync(
    join(root, "swift-fixture/docs/auth.md"),
    "<!-- @code Sources/AuthService.swift#AuthService -->\n## Auth Service\n",
  );

  mkdirSync(join(root, "dart-fixture/lib"), { recursive: true });
  mkdirSync(join(root, "dart-fixture/docs"), { recursive: true });
  writeFixtureConfig(root, "dart-fixture", {
    dart: { patterns: ["lib/**/*.dart"] },
  });
  writeFileSync(
    join(root, "dart-fixture/lib/auth_service.dart"),
    "/// @doc docs/auth.md#auth-service\nclass AuthService {}\n",
  );
  writeFileSync(
    join(root, "dart-fixture/docs/auth.md"),
    "<!-- @code lib/auth_service.dart#AuthService -->\n## Auth Service\n",
  );

  mkdirSync(join(root, "rust-fixture/src"), { recursive: true });
  mkdirSync(join(root, "rust-fixture/docs"), { recursive: true });
  writeFixtureConfig(root, "rust-fixture", {
    rust: { patterns: ["src/**/*.rs"] },
  });
  writeFileSync(
    join(root, "rust-fixture/src/auth_service.rs"),
    "/// @doc docs/auth.md#auth-service\npub struct AuthService;\n",
  );
  writeFileSync(
    join(root, "rust-fixture/docs/auth.md"),
    "<!-- @code src/auth_service.rs#AuthService -->\n## Auth Service\n",
  );
}

function writeFixtureConfig(
  tempRoot: string,
  fixtureName: string,
  code: Record<string, { patterns: string[] }>,
): void {
  writeFileSync(
    join(tempRoot, fixtureName, "docbridge.config.json"),
    JSON.stringify({ include: { code, docs: ["docs/**/*.md"] } }),
  );
}

export function assertDocumentationCommands(execute: (args: string[]) => CommandResult): void {
  const listResult = execute(["docs", "list", "--json"]);
  assertExitCode(listResult, 0, "docs list --json");
  if (listResult.stderr !== "") {
    throw new Error("docs list --json wrote unexpected stderr output");
  }
  const listOutput = JSON.parse(listResult.stdout) as {
    documents?: Array<{ name?: string }>;
  };
  const listedNames = listOutput.documents?.map(({ name }) => name) ?? [];
  if (JSON.stringify(listedNames) !== JSON.stringify(canonicalDocumentationNames)) {
    throw new Error(`docs list returned non-canonical names: ${listedNames.join(", ")}`);
  }

  const canonicalBodies = new Map<string, string>();
  for (const name of canonicalDocumentationNames) {
    const result = execute(["docs", "show", name]);
    assertExitCode(result, 0, `docs show ${name}`);
    if (result.stdout === "" || result.stderr !== "") {
      throw new Error(`docs show ${name} did not return clean canonical output`);
    }
    canonicalBodies.set(name, result.stdout);
  }

  for (const [legacy, canonical] of Object.entries(legacyDocumentationNames)) {
    const result = execute(["docs", "show", legacy]);
    assertExitCode(result, 0, `docs show ${legacy}`);
    if (result.stdout !== canonicalBodies.get(canonical)) {
      throw new Error(`docs show ${legacy} did not return ${canonical}`);
    }
    const warning = `Documentation name '${legacy}' is deprecated; use '${canonical}'.\n`;
    if (result.stderr !== warning) {
      throw new Error(`docs show ${legacy} did not return the deprecation warning`);
    }
  }

  const unknown = execute(["docs", "show", "missing"]);
  assertExitCode(unknown, 1, "docs show missing");
  const availableNames = `Available names:\n  ${canonicalDocumentationNames.join(", ")}`;
  if (unknown.stdout !== "" || !unknown.stderr.includes(availableNames)) {
    throw new Error("docs show missing did not return the canonical unknown-name error");
  }
  for (const legacy of Object.keys(legacyDocumentationNames)) {
    if (unknown.stderr.includes(legacy)) {
      throw new Error(`docs show missing exposed legacy name ${legacy}`);
    }
  }
}

/**
 * Exercise `upgrade` against a throwaway project inside the installed package.
 *
 * The packed layout resolves `templates/skills` through a different package
 * root than a source checkout, so installing the managed skill is only really
 * covered from the tarball. The fixture is created by the caller and carries
 * one legacy skill directory, so the read-only and destructive paths are both
 * observed.
 */
export function assertUpgradeCommand(input: {
  execute: (args: string[]) => CommandResult;
  fixtureRoot: string;
  exists?: (path: string) => boolean;
}): void {
  const exists = input.exists ?? existsSync;
  const legacySkill = join(input.fixtureRoot, ".claude/skills/docbridge-adopt");
  const managedSkill = join(input.fixtureRoot, ".claude/skills/docbridge");

  const check = input.execute(["upgrade", "--check", "--root", input.fixtureRoot]);
  assertExitCode(check, 0, "upgrade --check");
  for (const expected of [
    "- .claude/skills/docbridge: absent",
    "- .claude/skills/docbridge-adopt (directory)",
  ]) {
    if (!check.stdout.includes(expected)) {
      throw new Error(`upgrade --check did not report: ${expected}`);
    }
  }
  if (check.stdout.includes("Operations:")) {
    throw new Error("upgrade --check planned operations; it must stay read-only");
  }
  if (!exists(legacySkill)) {
    throw new Error("upgrade --check removed a legacy skill directory");
  }

  const apply = input.execute(["upgrade", "--force", "--yes", "--root", input.fixtureRoot]);
  assertExitCode(apply, 0, "upgrade --force --yes");
  if (!exists(join(managedSkill, "SKILL.md"))) {
    throw new Error("upgrade did not install the managed docbridge skill from the packed package");
  }
  if (exists(legacySkill)) {
    throw new Error("upgrade --force did not remove the legacy skill directory");
  }
}

function assertExitCode(result: CommandResult, expected: number, label: string): void {
  if (result.exitCode !== expected) {
    throw new Error(`${label} exited ${result.exitCode}; expected ${expected}`);
  }
}

function runResult(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function run(command: string[], cwd: string): void {
  const result = runResult(command, cwd);
  if (result.exitCode !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`Command failed: ${command.join(" ")}`);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(args: string[]): { tarball: string; options: SmokeOptions } {
  const tarball = args[0];
  if (tarball === undefined) {
    fail("Usage: bun run scripts/smoke-packed-package.ts <tarball> [--skip-scanner-fixtures]");
  }
  const options: SmokeOptions = { scannerFixtures: true };
  for (const arg of args.slice(1)) {
    if (arg === "--skip-scanner-fixtures") {
      options.scannerFixtures = false;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return { tarball, options };
}

function relativeToRoot(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

if (import.meta.main) {
  const { tarball, options } = parseArgs(Bun.argv.slice(2));
  try {
    smokePackedPackage(tarball, options);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
