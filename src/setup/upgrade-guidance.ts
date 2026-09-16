/**
 * Package-manager upgrade guidance for the running CLI binary.
 *
 * DocBridge never upgrades itself: it is consumed through Bun, npm, pnpm,
 * Yarn, global installs, and package-manager runners, so invoking one of them
 * would make the real install state implicit and could silently disagree with
 * the project's lockfile. Instead the CLI detects what it can and prints the
 * command the user should run.
 */

import { sep } from "node:path";

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export type InstallScope = "project" | "global" | "unknown";

export type UpgradeGuidance = {
  /** Detected from the invoking package manager, when it announced itself. */
  packageManager: PackageManager | undefined;
  scope: InstallScope;
  /** The single command to print first. */
  primaryCommand: string;
  /** Equivalent commands for the package managers that were not detected. */
  alternativeCommands: string[];
};

const PACKAGE_MANAGERS: readonly PackageManager[] = ["bun", "npm", "pnpm", "yarn"];

const PROJECT_COMMANDS: Record<PackageManager, string> = {
  bun: "bun add -d docbridge@latest",
  npm: "npm install --save-dev docbridge@latest",
  pnpm: "pnpm add -D docbridge@latest",
  yarn: "yarn add -D docbridge@latest",
};

const GLOBAL_COMMANDS: Record<PackageManager, string> = {
  bun: "bun add -g docbridge@latest",
  npm: "npm install -g docbridge@latest",
  pnpm: "pnpm add -g docbridge@latest",
  yarn: "yarn global add docbridge@latest",
};

type GuidanceEnv = Readonly<Record<string, string | undefined>>;

/**
 * Identify the package manager that spawned the current process from the
 * `npm_config_user_agent` string every major manager sets for its scripts.
 * A direct binary invocation leaves it unset, which stays `undefined`.
 */
export function detectPackageManager(env: GuidanceEnv = process.env): PackageManager | undefined {
  const userAgent = env.npm_config_user_agent;
  if (userAgent === undefined || userAgent.length === 0) {
    return undefined;
  }

  const name = userAgent.trim().split("/", 1)[0]?.toLowerCase();
  return PACKAGE_MANAGERS.find((manager) => manager === name);
}

/**
 * Classify where the running package lives.
 *
 * The decisive fact is the package's _install base_: the directory holding the
 * first `node_modules` in its path. `/repo/node_modules/docbridge` and the pnpm
 * shape `/repo/node_modules/.pnpm/docbridge@1.0.0/node_modules/docbridge` both
 * resolve to `/repo`.
 *
 * The install is a project dependency when that base is one of the candidate
 * roots or an ancestor of one — the same upward resolution npm and Bun perform.
 * Passing both the selected project root and the current directory matters:
 * `--root /repo` run from elsewhere, and a bare invocation from `/repo/sub`,
 * are both project installs, and calling either one global would send the user
 * to upgrade a different installation than the one that produced the message.
 * A checkout with no `node_modules` at all stays `unknown` rather than guessing.
 */
export function detectInstallScope(
  packageRoot: string,
  candidateRoots: readonly string[],
): InstallScope {
  const installBase = resolveInstallBase(packageRoot);
  if (installBase === undefined) {
    return "unknown";
  }

  return candidateRoots.some((root) => isSameOrAncestor(installBase, root)) ? "project" : "global";
}

/**
 * Build the guidance shown by the update notice and by `upgrade --check`.
 * An undetected scope is presented with the project-dependency command, which
 * is the common case, and the global forms stay available as alternatives.
 *
 * @doc docs/specs/cli.md#upgrade-guidance
 */
export function detectUpgradeGuidance(input: {
  packageRoot: string;
  projectRoot: string;
  /** Defaults to the process working directory; see `detectInstallScope`. */
  currentDirectory?: string;
  env?: GuidanceEnv;
}): UpgradeGuidance {
  const packageManager = detectPackageManager(input.env ?? process.env);
  const scope = detectInstallScope(input.packageRoot, [
    input.projectRoot,
    input.currentDirectory ?? process.cwd(),
  ]);
  const commands = scope === "global" ? GLOBAL_COMMANDS : PROJECT_COMMANDS;
  const primaryManager = packageManager ?? "npm";

  return {
    packageManager,
    scope,
    primaryCommand: commands[primaryManager],
    alternativeCommands: PACKAGE_MANAGERS.filter((manager) => manager !== primaryManager).map(
      (manager) => commands[manager],
    ),
  };
}

/** Render the guidance as the lines shared by the notice and the command. */
export function formatUpgradeGuidance(guidance: UpgradeGuidance): string[] {
  const scopeLabel =
    guidance.scope === "unknown" ? "install scope not detected" : `${guidance.scope} install`;
  return [
    `Upgrade command (${scopeLabel}): ${guidance.primaryCommand}`,
    `Other package managers: ${guidance.alternativeCommands.join(", ")}`,
  ];
}

/** The directory holding the first `node_modules` component of `packageRoot`. */
function resolveInstallBase(packageRoot: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const markerIndex = withTrailingSeparator(packageRoot).indexOf(marker);
  return markerIndex === -1 ? undefined : packageRoot.slice(0, markerIndex);
}

function isSameOrAncestor(candidate: string, descendant: string): boolean {
  return withTrailingSeparator(descendant).startsWith(withTrailingSeparator(candidate));
}

function withTrailingSeparator(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}
