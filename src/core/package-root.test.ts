import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolvePackageRoot } from "./package-root";

test("resolvePackageRoot finds templates/skills for source-layout execution", () => {
  const repo = mkdtempSync(join(tmpdir(), "docbridge-pkg-src-"));
  try {
    mkdirSync(join(repo, "templates", "skills"), { recursive: true });
    mkdirSync(join(repo, "src", "core"), { recursive: true });
    const moduleFile = join(repo, "src", "core", "package-root.ts");
    writeFileSync(moduleFile, "");

    expect(resolvePackageRoot(pathToFileURL(moduleFile).href)).toBe(realpathSync(repo));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolvePackageRoot finds templates/skills for dist-layout execution", () => {
  const pkg = mkdtempSync(join(tmpdir(), "docbridge-pkg-dist-"));
  try {
    mkdirSync(join(pkg, "templates", "skills"), { recursive: true });
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const moduleFile = join(pkg, "dist", "index.js");
    writeFileSync(moduleFile, "");

    expect(resolvePackageRoot(pathToFileURL(moduleFile).href)).toBe(realpathSync(pkg));
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});

test("resolvePackageRoot resolves the installed node_modules/.bin shim to its package", () => {
  const install = mkdtempSync(join(tmpdir(), "docbridge-pkg-bin-"));
  try {
    const packageRoot = join(install, "node_modules", "docbridge");
    mkdirSync(join(packageRoot, "templates", "skills"), { recursive: true });
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    const bundle = join(packageRoot, "dist", "index.js");
    writeFileSync(bundle, "");
    mkdirSync(join(install, "node_modules", ".bin"), { recursive: true });
    const shim = join(install, "node_modules", ".bin", "docbridge");
    symlinkSync(bundle, shim);

    expect(resolvePackageRoot(pathToFileURL(shim).href)).toBe(realpathSync(packageRoot));
  } finally {
    rmSync(install, { recursive: true, force: true });
  }
});
