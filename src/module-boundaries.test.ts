import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { collectFiles } from "./shared/glob";

/**
 * Static module-boundary contract for `src/`.
 *
 * These assertions describe ownership and dependency direction, so they count
 * type-only imports too: a type imported across a boundary still places the
 * declaration in the wrong module even though it leaves no runtime edge.
 */
const SRC_ROOT = resolve(import.meta.dir);
const REPO_ROOT = resolve(SRC_ROOT, "..");

const IMPORT_PATTERN = /(?:from|import)\s*["']([^"']+)["']/g;

function productionModules(): string[] {
  return collectFiles(REPO_ROOT, ["src/**/*.ts"]).filter(
    (relPath) => !relPath.endsWith(".test.ts"),
  );
}

/** Resolve one relative specifier to a repository-relative `src/` module path. */
function resolveSpecifier(fromRelPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const resolved = resolve(dirname(join(REPO_ROOT, fromRelPath)), specifier);
  const candidate = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
  const relPath = relative(REPO_ROOT, candidate);
  return relPath.startsWith("src/") ? relPath : undefined;
}

function directImports(relPath: string): string[] {
  const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
  const imports: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    const target = resolveSpecifier(relPath, specifier);
    if (target !== undefined) {
      imports.push(target);
    }
  }
  return imports;
}

/** Every `src/` module reachable from `entry`, excluding `entry` itself. */
function transitiveImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      continue;
    }
    for (const next of directImports(current)) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(entry);
  return seen;
}

function modulesUnder(directory: string): string[] {
  return productionModules().filter((relPath) => relPath.startsWith(directory));
}

/**
 * The layers each directory may import directly, including itself. Entry
 * points (`src/cli/`, `src/lsp/`) sit above every layer and are covered by the
 * entrypoint rules below.
 */
const ALLOWED_LAYER_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  model: ["model"],
  shared: ["model", "shared"],
  config: ["model", "shared", "config"],
  scan: ["model", "shared", "config", "scan"],
  link: ["model", "shared", "link"],
  query: ["model", "shared", "config", "scan", "link", "query"],
  setup: ["model", "shared", "config", "setup"],
};

function layerOf(relPath: string): string | undefined {
  return relPath.split("/")[1];
}

describe("layers import only the layers below them", () => {
  for (const [layer, allowed] of Object.entries(ALLOWED_LAYER_IMPORTS)) {
    test(`src/${layer}/ imports only ${allowed.join(", ")}`, () => {
      const offenders = modulesUnder(`src/${layer}/`).flatMap((relPath) =>
        directImports(relPath)
          .filter((target) => !allowed.includes(layerOf(target) ?? ""))
          .map((target) => `${relPath} -> ${target}`),
      );
      expect(offenders).toEqual([]);
    });
  }

  test("every production module outside the entrypoints belongs to a layer", () => {
    const unassigned = productionModules().filter((relPath) => {
      const layer = layerOf(relPath);
      return (
        !relPath.endsWith("test-support.ts") &&
        layer !== "cli" &&
        layer !== "lsp" &&
        (layer === undefined || !(layer in ALLOWED_LAYER_IMPORTS))
      );
    });
    expect(unassigned).toEqual([]);
  });

  test("setup owns initialization, skill installation, registry access, and update guidance", () => {
    expect(modulesUnder("src/setup/").toSorted()).toEqual([
      "src/setup/init-discovery.ts",
      "src/setup/init-plan.ts",
      "src/setup/registry.ts",
      "src/setup/skill-assets.ts",
      "src/setup/update-cache.ts",
      "src/setup/update-notice.ts",
      "src/setup/upgrade-guidance.ts",
      "src/setup/upgrade-plan.ts",
      "src/setup/version.ts",
    ]);
  });
});

describe("CLI command modules do not import the executable entrypoint", () => {
  test("only the entrypoint itself depends on src/cli/index.ts", () => {
    const offenders = productionModules().filter(
      (relPath) =>
        relPath !== "src/cli/index.ts" && directImports(relPath).includes("src/cli/index.ts"),
    );
    expect(offenders).toEqual([]);
  });

  test("the language server never depends on the CLI", () => {
    const offenders = modulesUnder("src/lsp/").flatMap((relPath) =>
      [...transitiveImports(relPath)]
        .filter((target) => target.startsWith("src/cli/"))
        .map((target) => `${relPath} -> ${target}`),
    );
    expect(offenders).toEqual([]);
  });

  test("the documentation command resolves package paths without initialization planning", () => {
    const planningModules = [...transitiveImports("src/cli/docs.ts")].filter(
      (target) => target.endsWith("/init-plan.ts") || target.startsWith("src/setup/"),
    );
    expect(planningModules).toEqual([]);
  });
});
