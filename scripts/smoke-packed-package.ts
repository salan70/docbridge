#!/usr/bin/env bun

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const tarball = Bun.argv[2];
if (tarball === undefined) {
  fail("Usage: bun run scripts/smoke-packed-package.ts <tarball>");
}

const tarballPath = resolve(tarball);
const tempRoot = mkdtempSync(join(tmpdir(), "speclink-pack-smoke-"));

try {
  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ private: true, dependencies: {} }, null, 2),
  );
  run(["npm", "install", tarballPath], tempRoot);
  run(["bun", "node_modules/.bin/speclink", "--version"], tempRoot);
  run(["bun", "node_modules/.bin/speclink", "--help"], tempRoot);

  mkdirSync(join(tempRoot, "fixture/src"), { recursive: true });
  mkdirSync(join(tempRoot, "fixture/docs"), { recursive: true });
  writeFileSync(
    join(tempRoot, "fixture/speclink.config.json"),
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
  run(
    [
      "bun",
      join(tempRoot, "node_modules/.bin/speclink"),
      "check",
      "--root",
      join(tempRoot, "fixture"),
    ],
    tempRoot,
  );

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
  run(
    [
      "bun",
      join(tempRoot, "node_modules/.bin/speclink"),
      "check",
      "--root",
      join(tempRoot, "swift-fixture"),
    ],
    tempRoot,
  );

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
  run(
    [
      "bun",
      join(tempRoot, "node_modules/.bin/speclink"),
      "check",
      "--root",
      join(tempRoot, "dart-fixture"),
    ],
    tempRoot,
  );
  console.log(`Smoke-tested ${basename(tarballPath)} in ${tempRoot}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function writeFixtureConfig(
  tempRoot: string,
  fixtureName: string,
  code: Record<string, { patterns: string[] }>,
): void {
  writeFileSync(
    join(tempRoot, fixtureName, "speclink.config.json"),
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
