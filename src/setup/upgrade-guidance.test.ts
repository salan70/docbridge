import { expect, test } from "bun:test";
import { sep } from "node:path";

import {
  detectInstallScope,
  detectPackageManager,
  detectUpgradeGuidance,
  formatUpgradeGuidance,
} from "./upgrade-guidance";

const path = (...segments: string[]) => `${sep}${segments.join(sep)}`;

test.each([
  ["bun/1.1.31 npm/? node/v22.0.0 linux x64", "bun"],
  ["npm/10.2.0 node/v22.0.0 linux x64", "npm"],
  ["pnpm/9.1.0 npm/? node/v22.0.0", "pnpm"],
  ["yarn/4.1.0 npm/? node/v22.0.0", "yarn"],
  ["NPM/10.2.0 node/v22.0.0", "npm"],
])("detectPackageManager reads %s", (userAgent, expected) => {
  expect(detectPackageManager({ npm_config_user_agent: userAgent })).toBe(
    expected as ReturnType<typeof detectPackageManager>,
  );
});

test.each([
  [undefined, "unset"],
  ["", "empty"],
  ["deno/2.0.0", "unknown manager"],
])("detectPackageManager returns undefined for %s (%s)", (userAgent) => {
  expect(detectPackageManager({ npm_config_user_agent: userAgent })).toBeUndefined();
});

test("detectInstallScope reports a project dependency", () => {
  expect(detectInstallScope(path("repo", "node_modules", "docbridge"), [path("repo")])).toBe(
    "project",
  );
});

test("detectInstallScope reports a project dependency from a nested directory", () => {
  expect(
    detectInstallScope(path("repo", "node_modules", "docbridge"), [
      path("repo", "packages", "web"),
    ]),
  ).toBe("project");
});

test("detectInstallScope reports a project dependency behind the pnpm store layout", () => {
  const pnpmRoot = path(
    "repo",
    "node_modules",
    ".pnpm",
    "docbridge@1.0.0",
    "node_modules",
    "docbridge",
  );

  expect(detectInstallScope(pnpmRoot, [path("repo")])).toBe("project");
});

test("detectInstallScope accepts any candidate root", () => {
  expect(
    detectInstallScope(path("repo", "node_modules", "docbridge"), [
      path("elsewhere"),
      path("repo", "sub"),
    ]),
  ).toBe("project");
});

test("detectInstallScope reports a global install", () => {
  expect(
    detectInstallScope(path("usr", "local", "lib", "node_modules", "docbridge"), [path("repo")]),
  ).toBe("global");
});

test("detectInstallScope does not treat a sibling project as a project install", () => {
  expect(detectInstallScope(path("repo", "node_modules", "docbridge"), [path("repo-other")])).toBe(
    "global",
  );
});

test("detectInstallScope reports unknown for a source checkout", () => {
  expect(detectInstallScope(path("repo"), [path("repo")])).toBe("unknown");
});

test("detectUpgradeGuidance keeps project scope when --root selects the install's project", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo", "node_modules", "docbridge"),
    projectRoot: path("repo"),
    currentDirectory: path("somewhere", "else"),
    env: {},
  });

  expect(guidance.scope).toBe("project");
  expect(guidance.primaryCommand).toBe("npm install --save-dev docbridge@latest");
});

test("detectUpgradeGuidance keeps project scope for a nested current directory", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo", "node_modules", "docbridge"),
    projectRoot: path("repo", "packages", "web"),
    currentDirectory: path("repo", "packages", "web"),
    env: {},
  });

  expect(guidance.scope).toBe("project");
});

test("detectUpgradeGuidance prefers the detected manager and project scope", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo", "node_modules", "docbridge"),
    projectRoot: path("repo"),
    currentDirectory: path("repo"),
    env: { npm_config_user_agent: "bun/1.1.31 npm/? node/v22.0.0" },
  });

  expect(guidance.packageManager).toBe("bun");
  expect(guidance.scope).toBe("project");
  expect(guidance.primaryCommand).toBe("bun add -d docbridge@latest");
  expect(guidance.alternativeCommands).toEqual([
    "npm install --save-dev docbridge@latest",
    "pnpm add -D docbridge@latest",
    "yarn add -D docbridge@latest",
  ]);
});

test("detectUpgradeGuidance uses global commands for a global install", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("usr", "local", "lib", "node_modules", "docbridge"),
    projectRoot: path("repo"),
    currentDirectory: path("repo"),
    env: {},
  });

  expect(guidance.scope).toBe("global");
  expect(guidance.primaryCommand).toBe("npm install -g docbridge@latest");
  expect(guidance.alternativeCommands).toContain("bun add -g docbridge@latest");
});

test("detectUpgradeGuidance falls back to the project npm command when nothing is detected", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo"),
    projectRoot: path("repo"),
    currentDirectory: path("repo"),
    env: {},
  });

  expect(guidance.packageManager).toBeUndefined();
  expect(guidance.scope).toBe("unknown");
  expect(guidance.primaryCommand).toBe("npm install --save-dev docbridge@latest");
});

test("formatUpgradeGuidance labels the detected scope", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo", "node_modules", "docbridge"),
    projectRoot: path("repo"),
    currentDirectory: path("repo"),
    env: {},
  });

  expect(formatUpgradeGuidance(guidance)[0]).toBe(
    "Upgrade command (project install): npm install --save-dev docbridge@latest",
  );
});

test("formatUpgradeGuidance says so when the scope is undetected", () => {
  const guidance = detectUpgradeGuidance({
    packageRoot: path("repo"),
    projectRoot: path("repo"),
    currentDirectory: path("repo"),
    env: {},
  });

  expect(formatUpgradeGuidance(guidance)[0]).toContain("install scope not detected");
});
