import { statSync } from "node:fs";
import { resolve } from "node:path";

import { resolvePackageRoot } from "../core/package-root";
import { discoverRepository } from "../setup/init-discovery";
import type { AgentTarget } from "../setup/init-discovery";
import type { LatestVersionLookup } from "../setup/registry";
import { applySkillOperation } from "../setup/skill-assets";
import { detectUpgradeGuidance } from "../setup/upgrade-guidance";
import {
  formatUpgradePlan,
  planUpgrade,
  type UpgradeOptions,
  type UpgradePlan,
} from "../setup/upgrade-plan";
import {
  agentTargetGuidance,
  CliError,
  commandHelpGuidance,
  rootPathGuidance,
  upgradeConfirmationGuidance,
} from "./errors";
import type { InitRuntime } from "./init";
import type { CliIo } from "./io";

const AGENT_TARGETS = new Set<AgentTarget>(["codex", "claude", "both", "none"]);

export type UpgradeRuntime = {
  /** Registry lookup resolved before dispatch; `unavailable` when offline. */
  latest: LatestVersionLookup;
  currentVersion: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Defaults to the process working directory; see `detectInstallScope`. */
  currentDirectory?: string;
};

/**
 * Parse `upgrade` options.
 *
 * @doc docs/specs/cli.md#upgrade-command
 */
export function parseUpgradeOptions(args: string[]): UpgradeOptions {
  const options: UpgradeOptions = {
    root: ".",
    agentTarget: undefined,
    check: false,
    dryRun: false,
    yes: false,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new CliError("--root requires a path.", rootPathGuidance("upgrade"));
      }
      options.root = root;
      index += 1;
      continue;
    }
    if (arg === "--agent-target") {
      options.agentTarget = parseAgentTarget(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`, commandHelpGuidance("upgrade"));
    }

    throw new CliError(`Unexpected argument: ${arg}`, commandHelpGuidance("upgrade"));
  }

  return options;
}

/**
 * Report version drift and reconcile managed agent assets.
 *
 * The command owns exactly two kinds of path: the managed `docbridge` skill
 * directory and the five known legacy skill directories. It never edits the
 * CLI package, `docbridge.config.json`, hooks, CI recipes, or user code, and
 * it never runs a package manager on the user's behalf.
 *
 * @doc docs/specs/cli.md#upgrade-command
 * @doc docs/user/commands.md#upgrade-keep-the-cli-and-skills-in-step
 */
export function runUpgrade(
  options: UpgradeOptions,
  io: CliIo,
  initRuntime: InitRuntime,
  runtime: UpgradeRuntime,
): number {
  const projectRoot = resolveProjectRoot(options.root);
  const packageRoot = initRuntime.packageRoot ?? resolvePackageRoot();
  const plan = planUpgrade({
    projectRoot,
    packageRoot,
    currentVersion: runtime.currentVersion,
    latest: runtime.latest,
    guidance: detectUpgradeGuidance({
      packageRoot,
      projectRoot,
      ...(runtime.currentDirectory !== undefined
        ? { currentDirectory: runtime.currentDirectory }
        : {}),
      ...(runtime.env !== undefined ? { env: runtime.env } : {}),
    }),
    discovery: discoverRepository(projectRoot),
    options,
  });

  if (plan.mode === "check" || options.dryRun) {
    io.stdout(formatUpgradePlan(plan));
    return plan.exitCode;
  }

  return applyUpgrade(projectRoot, packageRoot, plan, io, initRuntime);
}

function applyUpgrade(
  projectRoot: string,
  packageRoot: string,
  plan: UpgradePlan,
  io: CliIo,
  initRuntime: InitRuntime,
): number {
  if (plan.requiresConfirmation && !initRuntime.prompts.isInteractive) {
    throw new CliError(
      "Replacing or removing managed skill directories requires confirmation.",
      upgradeConfirmationGuidance(),
    );
  }

  if (
    plan.requiresConfirmation &&
    !initRuntime.prompts.confirm(
      `Apply ${plan.operations.length} operation(s) to managed skill directories?`,
      false,
    )
  ) {
    io.stdout(formatUpgradePlan(plan));
    io.stdout("No changes were applied.\n");
    return 0;
  }

  for (const operation of plan.operations) {
    applySkillOperation(projectRoot, packageRoot, operation);
  }

  io.stdout(formatUpgradePlan(plan));
  return plan.exitCode;
}

function parseAgentTarget(value: string | undefined): AgentTarget {
  if (value === undefined) {
    throw new CliError("--agent-target requires a value.", agentTargetGuidance("upgrade"));
  }
  if (!AGENT_TARGETS.has(value as AgentTarget)) {
    throw new CliError(
      `Unknown agent target: ${value}. Supported values: codex, claude, both, none.`,
      agentTargetGuidance("upgrade"),
    );
  }
  return value as AgentTarget;
}

function resolveProjectRoot(root: string): string {
  const projectRoot = resolve(root);

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new CliError(`Root path does not exist: ${root}`, rootPathGuidance("upgrade"));
  }

  if (!stats.isDirectory()) {
    throw new CliError(`Root path is not a directory: ${root}`, rootPathGuidance("upgrade"));
  }

  return projectRoot;
}
