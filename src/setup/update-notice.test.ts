import { expect, test } from "bun:test";
import { sep } from "node:path";

import {
  decideUpdateCheck,
  formatUpdateNotice,
  isUpdateCheckOptedOut,
  shouldCheckForUpdates,
} from "./update-notice";
import { detectUpgradeGuidance } from "./upgrade-guidance";

const guidance = detectUpgradeGuidance({
  packageRoot: `${sep}repo${sep}node_modules${sep}docbridge`,
  projectRoot: `${sep}repo`,
  currentDirectory: `${sep}repo`,
  env: { npm_config_user_agent: "bun/1.1.31 npm/? node/v22.0.0" },
});

test("decideUpdateCheck enables a human-readable TTY invocation", () => {
  expect(decideUpdateCheck({ argv: ["check"], env: {}, isTty: true })).toEqual({ enabled: true });
});

test("decideUpdateCheck enables a bare invocation with no command", () => {
  expect(shouldCheckForUpdates({ argv: [], env: {}, isTty: true })).toBe(true);
});

test.each([
  ["1", "one"],
  ["true", "true"],
  ["yes", "any non-empty value"],
])("decideUpdateCheck honors DOCBRIDGE_NO_UPDATE_CHECK=%s (%s)", (value) => {
  expect(
    decideUpdateCheck({ argv: ["check"], env: { DOCBRIDGE_NO_UPDATE_CHECK: value }, isTty: true }),
  ).toEqual({ enabled: false, reason: "opt-out" });
});

test.each([
  ["0", "zero"],
  ["false", "false"],
  ["", "empty"],
])("decideUpdateCheck ignores DOCBRIDGE_NO_UPDATE_CHECK=%s (%s)", (value) => {
  expect(
    shouldCheckForUpdates({
      argv: ["check"],
      env: { DOCBRIDGE_NO_UPDATE_CHECK: value },
      isTty: true,
    }),
  ).toBe(true);
});

test("decideUpdateCheck suppresses the notice in CI", () => {
  expect(decideUpdateCheck({ argv: ["check"], env: { CI: "true" }, isTty: true })).toEqual({
    enabled: false,
    reason: "ci",
  });
});

test("decideUpdateCheck suppresses the notice when stderr is not a TTY", () => {
  expect(decideUpdateCheck({ argv: ["check"], env: {}, isTty: false })).toEqual({
    enabled: false,
    reason: "non-tty",
  });
});

test("decideUpdateCheck suppresses the notice for JSON output", () => {
  expect(decideUpdateCheck({ argv: ["check", "--json"], env: {}, isTty: true })).toEqual({
    enabled: false,
    reason: "json-output",
  });
});

test.each(["lsp", "upgrade"])("decideUpdateCheck suppresses the notice for %s", (command) => {
  expect(decideUpdateCheck({ argv: [command], env: {}, isTty: true })).toEqual({
    enabled: false,
    reason: "machine-command",
  });
});

test("decideUpdateCheck reports the opt-out first when several rules apply", () => {
  expect(
    decideUpdateCheck({
      argv: ["check", "--json"],
      env: { CI: "1", DOCBRIDGE_NO_UPDATE_CHECK: "1" },
      isTty: false,
    }),
  ).toEqual({ enabled: false, reason: "opt-out" });
});

test("isUpdateCheckOptedOut reads the opt-out variable", () => {
  expect(isUpdateCheckOptedOut({ DOCBRIDGE_NO_UPDATE_CHECK: "1" })).toBe(true);
  expect(isUpdateCheckOptedOut({ DOCBRIDGE_NO_UPDATE_CHECK: "0" })).toBe(false);
  expect(isUpdateCheckOptedOut({})).toBe(false);
});

test("formatUpdateNotice renders a concise three-line notice", () => {
  const notice = formatUpdateNotice({ current: "0.8.0", latest: "0.9.0", guidance });

  expect(notice).toBe(
    [
      "Update available: docbridge 0.8.0 -> 0.9.0",
      "Upgrade command (project install): bun add -d docbridge@latest",
      "Run `docbridge upgrade --check` for details, or set DOCBRIDGE_NO_UPDATE_CHECK=1 to silence this notice.",
      "",
    ].join("\n"),
  );
});

test("formatUpdateNotice is silent when the CLI is up to date", () => {
  expect(formatUpdateNotice({ current: "0.8.0", latest: "0.8.0", guidance })).toBeUndefined();
});

test("formatUpdateNotice is silent when the registry is behind", () => {
  expect(formatUpdateNotice({ current: "0.9.0", latest: "0.8.0", guidance })).toBeUndefined();
});

test("formatUpdateNotice is silent for a prerelease on the registry", () => {
  expect(formatUpdateNotice({ current: "0.8.0", latest: "0.9.0-rc.1", guidance })).toBeUndefined();
});
