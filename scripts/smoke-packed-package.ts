#!/usr/bin/env bun

import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const scannerPlatformKeys = ["darwin-arm64", "linux-x64"] as const;
// The packaged CLI must work for both npm/Node and Bun consumers.
const cliRuntimes = ["node", "bun"] as const;
const scannerExecutableNames = ["speclink-swift-scanner", "speclink_dart_scanner"] as const;

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
    console.log(`Smoke-tested ${basename(tarballPath)} in ${tempRoot}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function assertInstalledScannerExecutables(installRoot: string): void {
  for (const platform of scannerPlatformKeys) {
    for (const executable of scannerExecutableNames) {
      const scannerPath = join(
        installRoot,
        "node_modules/docbridge/dist/bin",
        platform,
        executable,
      );
      if (existsSync(scannerPath) && (statSync(scannerPath).mode & 0o111) === 0) {
        throw new Error(`${relativeToRoot(installRoot, scannerPath)} is not executable.`);
      }
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

  mkdirSync(join(tempRoot, "swift-fixture/Sources"), { recursive: true });
  mkdirSync(join(tempRoot, "swift-fixture/docs"), { recursive: true });
  writeFixtureConfig(tempRoot, "swift-fixture", {
    swift: { patterns: ["Sources/**/*.swift"] },
  });
  writeFileSync(
    join(tempRoot, "swift-fixture/Sources/AuthService.swift"),
    "/// @doc docs/auth.md#auth-service\npublic struct AuthService {}\n",
  );
  writeFileSync(
    join(tempRoot, "swift-fixture/docs/auth.md"),
    "<!-- @code Sources/AuthService.swift#AuthService -->\n## Auth Service\n",
  );
  for (const runtime of cliRuntimes) {
    run(
      [
        runtime,
        join(tempRoot, "node_modules/.bin/docbridge"),
        "check",
        "--root",
        join(tempRoot, "swift-fixture"),
      ],
      tempRoot,
    );
  }

  mkdirSync(join(tempRoot, "dart-fixture/lib"), { recursive: true });
  mkdirSync(join(tempRoot, "dart-fixture/docs"), { recursive: true });
  writeFixtureConfig(tempRoot, "dart-fixture", {
    dart: { patterns: ["lib/**/*.dart"] },
  });
  writeFileSync(
    join(tempRoot, "dart-fixture/lib/auth_service.dart"),
    "/// @doc docs/auth.md#auth-service\nclass AuthService {}\n",
  );
  writeFileSync(
    join(tempRoot, "dart-fixture/docs/auth.md"),
    "<!-- @code lib/auth_service.dart#AuthService -->\n## Auth Service\n",
  );
  for (const runtime of cliRuntimes) {
    run(
      [
        runtime,
        join(tempRoot, "node_modules/.bin/docbridge"),
        "check",
        "--root",
        join(tempRoot, "dart-fixture"),
      ],
      tempRoot,
    );
  }
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
