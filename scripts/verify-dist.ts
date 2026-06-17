#!/usr/bin/env bun

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const distCli = join(repoRoot, "dist/index.js");

if (!existsSync(distCli)) {
  fail("dist/index.js does not exist. Run `just build` first.");
}

const content = await readFile(distCli, "utf8");
if (!content.startsWith("#!/usr/bin/env bun\n")) {
  fail("dist/index.js does not preserve the Bun shebang.");
}

if ((statSync(distCli).mode & 0o111) === 0) {
  fail("dist/index.js is not executable.");
}

run([distCli, "--version"]);
run([distCli, "--help"]);
run([distCli, "check", "--root", "examples/typescript"]);

function run(command: string[]): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: repoRoot,
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
