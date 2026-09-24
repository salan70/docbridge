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

test.each(["lsp", "upgrade"])("decideUpdateCheck suppresses the notice for %s", (command) => {
  expect(decideUpdateCheck({ argv: [command], env: {}, isTty: true })).toEqual({
    enabled: false,
    reason: "machine-command",
  });
});

test("isUpdateCheckOptedOut reads the opt-out variable", () => {
  expect(isUpdateCheckOptedOut({ DOCBRIDGE_NO_UPDATE_CHECK: "1" })).toBe(true);
  expect(isUpdateCheckOptedOut({ DOCBRIDGE_NO_UPDATE_CHECK: "0" })).toBe(false);
  expect(isUpdateCheckOptedOut({})).toBe(false);
});

test("formatUpdateNotice is silent when the registry is behind", () => {
  expect(formatUpdateNotice({ current: "0.9.0", latest: "0.8.0", guidance })).toBeUndefined();
});
