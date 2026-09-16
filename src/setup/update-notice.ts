/**
 * Eligibility and rendering for the passive "update available" notice.
 *
 * The notice is an aside on a human's terminal, never part of a command's
 * result: it is written to stderr, it never changes the exit code, and it is
 * suppressed for every consumer that parses DocBridge output. Machine-readable
 * runs, CI, the language server, and redirected output therefore stay
 * byte-for-byte what they were before the check existed.
 */

import { formatUpgradeGuidance, type UpgradeGuidance } from "./upgrade-guidance";
import { isNewerStableVersion } from "./version";

/** Commands whose own output would duplicate or be corrupted by the notice. */
const SUPPRESSED_COMMANDS = new Set(["lsp", "upgrade"]);

export type UpdateCheckSuppressionReason =
  | "opt-out"
  | "ci"
  | "non-tty"
  | "json-output"
  | "machine-command";

export type UpdateCheckDecision =
  | { enabled: true }
  | { enabled: false; reason: UpdateCheckSuppressionReason };

type NoticeEnv = Readonly<Record<string, string | undefined>>;

/**
 * Report whether the user has switched registry lookups off entirely.
 *
 * The variable is named for the check, not for the notice, so it also
 * suppresses the lookup `upgrade` would otherwise make: an operator who sets it
 * to keep DocBridge off the network gets that from every command.
 */
export function isUpdateCheckOptedOut(env: NoticeEnv = process.env): boolean {
  return isEnabledFlag(env.DOCBRIDGE_NO_UPDATE_CHECK);
}

/**
 * Decide whether this invocation may perform and print an update check.
 *
 * Ordering matters only for the reported reason, not for the verdict: the
 * first matching rule is reported so `--json` in CI blames the opt-out that a
 * user is most likely to control.
 *
 * @doc docs/specs/cli.md#update-notification
 */
export function decideUpdateCheck(input: {
  argv: readonly string[];
  env?: NoticeEnv;
  isTty: boolean;
}): UpdateCheckDecision {
  const env = input.env ?? process.env;

  if (isUpdateCheckOptedOut(env)) {
    return { enabled: false, reason: "opt-out" };
  }
  if (isEnabledFlag(env.CI)) {
    return { enabled: false, reason: "ci" };
  }
  if (!input.isTty) {
    return { enabled: false, reason: "non-tty" };
  }
  if (input.argv.includes("--json")) {
    return { enabled: false, reason: "json-output" };
  }

  const command = input.argv[0];
  if (command !== undefined && SUPPRESSED_COMMANDS.has(command)) {
    return { enabled: false, reason: "machine-command" };
  }

  return { enabled: true };
}

export function shouldCheckForUpdates(input: {
  argv: readonly string[];
  env?: NoticeEnv;
  isTty: boolean;
}): boolean {
  return decideUpdateCheck(input).enabled;
}

/**
 * Render the notice, or `undefined` when there is nothing to say. A latest
 * version that is not a strictly newer stable release — equal, older, a
 * prerelease, or unparsable — produces no output at all.
 *
 * @doc docs/specs/cli.md#update-notification
 */
export function formatUpdateNotice(input: {
  current: string;
  latest: string;
  guidance: UpgradeGuidance;
}): string | undefined {
  if (!isNewerStableVersion(input.latest, input.current)) {
    return undefined;
  }

  return [
    `Update available: docbridge ${input.current} -> ${input.latest}`,
    formatUpgradeGuidance(input.guidance)[0] ?? "",
    "Run `docbridge upgrade --check` for details, or set DOCBRIDGE_NO_UPDATE_CHECK=1 to silence this notice.",
    "",
  ].join("\n");
}

/**
 * Treat only an affirmative value as set. An empty, `0`, or `false` value is
 * how shells and CI images commonly express "not enabled", and reading them as
 * enabled would silently disable the notice everywhere.
 */
function isEnabledFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "0" && normalized !== "false";
}
