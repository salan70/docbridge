/**
 * Version diagnosis and managed-asset migration planning for `upgrade`.
 *
 * The plan is built without touching the filesystem so `--check` and
 * `--dry-run` can render exactly what a real run would do. Its scope is
 * deliberately narrow: the single managed `docbridge` skill directory and the
 * five known legacy skill directories. Configuration, hooks, CI recipes, user
 * code, and any other copied file are outside it and are never operated on.
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import type { AgentTarget, RepositoryDiscovery } from "./init-discovery";
import {
  agentDestinations,
  formatFileOp,
  INIT_SKILL_NAMES,
  LEGACY_SKILL_NAMES,
  listDistributableSkills,
  type PlannedFileOp,
} from "./init-plan";
import type { LatestVersionLookup } from "./registry";
import { classifyManagedPath, compareSkillTree, unmanageablePathMessage } from "./skill-assets";
import type { ManagedPathKind } from "./skill-assets";
import { formatUpgradeGuidance, type UpgradeGuidance } from "./upgrade-guidance";
import { isNewerStableVersion } from "./version";

const MANAGED_SKILL_NAME = INIT_SKILL_NAMES[0];

/**
 * `up-to-date`, `modified`, and `template-missing` describe an ordinary managed
 * directory. Every other value is a path shape the command refuses to touch and
 * reports instead; they mirror `ManagedPathKind`.
 */
export type ManagedSkillState =
  | "absent"
  | "symlink"
  | "symlinked-parent"
  | "non-directory"
  | "blocked-parent"
  | "up-to-date"
  | "modified"
  | "template-missing";

/** Only `directory` is removable; every other kind is reported and preserved. */
export type LegacySkillKind = Exclude<ManagedPathKind, "absent">;

export type ManagedSkillReport = {
  /** Agent destination directory, such as `.claude/skills`. */
  destination: string;
  /** Root-relative path of the managed skill directory. */
  path: string;
  state: ManagedSkillState;
  modifiedFiles: string[];
  missingFiles: string[];
  extraFiles: string[];
};

export type LegacySkillReport = {
  path: string;
  kind: LegacySkillKind;
};

export type CliVersionStatus = "up-to-date" | "outdated" | "ahead" | "unknown";

export type CliVersionReport = {
  current: string;
  latest: string | undefined;
  status: CliVersionStatus;
};

export type UpgradeMode = "check" | "apply";

export type UpgradeOptions = {
  root: string;
  agentTarget: AgentTarget | undefined;
  check: boolean;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
};

export type UpgradePlan = {
  mode: UpgradeMode;
  cli: CliVersionReport;
  guidance: UpgradeGuidance;
  managedSkills: ManagedSkillReport[];
  legacySkills: LegacySkillReport[];
  operations: PlannedFileOp[];
  /** Migrations withheld because `--force` was not supplied. */
  pending: string[];
  messages: string[];
  nextSteps: string[];
  /** Set when destructive operations need `--yes` or an interactive answer. */
  requiresConfirmation: boolean;
  exitCode: number;
};

/** Compare the running binary against the registry's latest stable release. */
export function reportCliVersion(
  currentVersion: string,
  latest: LatestVersionLookup,
): CliVersionReport {
  if (latest.status !== "ok") {
    return { current: currentVersion, latest: undefined, status: "unknown" };
  }
  if (isNewerStableVersion(latest.latest, currentVersion)) {
    return { current: currentVersion, latest: latest.latest, status: "outdated" };
  }
  if (isNewerStableVersion(currentVersion, latest.latest)) {
    return { current: currentVersion, latest: latest.latest, status: "ahead" };
  }
  return { current: currentVersion, latest: latest.latest, status: "up-to-date" };
}

/**
 * Resolve which agent destinations `upgrade` inspects. An explicit
 * `--agent-target` always wins; otherwise only the destinations that already
 * exist are considered, so the command never invents `.agents/` or `.claude/`.
 */
export function resolveUpgradeAgentTarget(
  discovery: RepositoryDiscovery,
  explicitTarget: AgentTarget | undefined,
): AgentTarget {
  return explicitTarget ?? discovery.agent.defaultTarget;
}

/** Describe the managed skill directory at one agent destination. */
export function inspectManagedSkill(input: {
  projectRoot: string;
  packageRoot: string;
  destination: string;
  templateAvailable: boolean;
}): ManagedSkillReport {
  const destinationDir = join(input.projectRoot, input.destination, MANAGED_SKILL_NAME);
  const path = toRootRelative(input.projectRoot, destinationDir);
  const empty = {
    destination: input.destination,
    path,
    modifiedFiles: [],
    missingFiles: [],
    extraFiles: [],
  };

  const kind = classifyManagedPath(input.projectRoot, path);
  if (kind !== "directory") {
    return { ...empty, state: kind };
  }
  if (!input.templateAvailable) {
    return { ...empty, state: "template-missing" };
  }

  const comparison = compareSkillTree(
    destinationDir,
    join(input.packageRoot, "templates", "skills", MANAGED_SKILL_NAME),
  );
  const drifted =
    comparison.modified.length > 0 || comparison.missing.length > 0 || comparison.extra.length > 0;

  return {
    destination: input.destination,
    path,
    state: drifted ? "modified" : "up-to-date",
    modifiedFiles: comparison.modified,
    missingFiles: comparison.missing,
    extraFiles: comparison.extra,
  };
}

/** List the legacy five-skill directories still present at one destination. */
export function inspectLegacySkills(projectRoot: string, destination: string): LegacySkillReport[] {
  const reports: LegacySkillReport[] = [];

  for (const skillName of LEGACY_SKILL_NAMES) {
    const destinationDir = join(projectRoot, destination, skillName);
    const path = toRootRelative(projectRoot, destinationDir);
    const kind = classifyManagedPath(projectRoot, path);
    if (kind === "absent") {
      continue;
    }
    // A symlinked ancestor classifies every name below it without looking at
    // the leaf, so confirm something is really there before reporting it.
    if (kind === "symlinked-parent" && !existsSync(destinationDir)) {
      continue;
    }
    reports.push({ path, kind });
  }

  return reports;
}

/**
 * Build the complete upgrade plan. `--check` short-circuits every operation so
 * the diagnostic path cannot write, regardless of the other flags.
 *
 * @doc docs/specs/cli.md#upgrade-command
 */
export function planUpgrade(input: {
  projectRoot: string;
  packageRoot: string;
  currentVersion: string;
  latest: LatestVersionLookup;
  guidance: UpgradeGuidance;
  discovery: RepositoryDiscovery;
  options: UpgradeOptions;
}): UpgradePlan {
  const mode: UpgradeMode = input.options.check ? "check" : "apply";
  const cli = reportCliVersion(input.currentVersion, input.latest);
  const agentTarget = resolveUpgradeAgentTarget(input.discovery, input.options.agentTarget);
  const templateAvailable = listDistributableSkills(input.packageRoot).includes(MANAGED_SKILL_NAME);
  const messages: string[] = [];

  const destinations = agentDestinations(agentTarget);
  const managedSkills = destinations.map((destination) =>
    inspectManagedSkill({
      projectRoot: input.projectRoot,
      packageRoot: input.packageRoot,
      destination,
      templateAvailable,
    }),
  );
  const legacySkills = destinations.flatMap((destination) =>
    inspectLegacySkills(input.projectRoot, destination),
  );

  if (destinations.length === 0) {
    messages.push(
      "No agent skill directory was selected, so no managed assets were inspected. Pass --agent-target codex, claude, or both to reconcile them.",
    );
  }
  if (!templateAvailable && destinations.length > 0) {
    messages.push(
      "The installed DocBridge package ships no docbridge skill template, so managed skills cannot be reconciled. Reinstall DocBridge.",
    );
  }
  addVersionMessages(cli, input.guidance, messages);

  const pending: string[] = [];
  const operations =
    mode === "check"
      ? []
      : planOperations({ managedSkills, legacySkills, options: input.options, pending });
  for (const report of managedSkills) {
    if (isUnmanageableState(report.state)) {
      messages.push(unmanageablePathMessage(report.path, report.state));
    }
  }
  for (const legacy of legacySkills) {
    if (legacy.kind !== "directory") {
      messages.push(unmanageablePathMessage(legacy.path, legacy.kind));
    }
  }

  return {
    mode,
    cli,
    guidance: input.guidance,
    managedSkills,
    legacySkills,
    operations,
    pending,
    messages,
    nextSteps: buildNextSteps({ mode, cli, options: input.options, pending }),
    requiresConfirmation:
      mode === "apply" &&
      !input.options.dryRun &&
      !input.options.yes &&
      operations.some(
        (operation) => operation.action === "overwrite" || operation.action === "remove",
      ),
    exitCode: 0,
  };
}

function planOperations(input: {
  managedSkills: ManagedSkillReport[];
  legacySkills: LegacySkillReport[];
  options: UpgradeOptions;
  pending: string[];
}): PlannedFileOp[] {
  const operations: PlannedFileOp[] = [];

  for (const report of input.managedSkills) {
    if (report.state === "template-missing" || isUnmanageableState(report.state)) {
      continue;
    }
    if (report.state === "absent") {
      operations.push({
        action: input.options.dryRun ? "would-create" : "create",
        path: report.path,
        reason: "Install the managed docbridge skill.",
      });
      continue;
    }
    if (!input.options.force) {
      input.pending.push(
        `${report.path} is ${report.state === "modified" ? "locally modified" : "already installed"} and was preserved. Re-run with --force to replace it with the packaged template.`,
      );
      continue;
    }
    operations.push({
      action: input.options.dryRun ? "would-overwrite" : "overwrite",
      path: report.path,
      reason: "Replace the managed docbridge skill with the packaged template.",
    });
  }

  for (const legacy of input.legacySkills) {
    if (legacy.kind !== "directory") {
      continue;
    }
    if (!input.options.force) {
      input.pending.push(
        `${legacy.path} is a leftover directory from the previous five-skill layout. Re-run with --force to remove it after reviewing local edits.`,
      );
      continue;
    }
    operations.push({
      action: input.options.dryRun ? "would-remove" : "remove",
      path: legacy.path,
      reason: "Remove leftover skill from the previous five-skill layout.",
    });
  }

  return operations;
}

/** States that name a path shape the command refuses to write to or remove. */
type UnmanageableSkillState = Exclude<ManagedPathKind, "absent" | "directory">;

function isUnmanageableState(state: ManagedSkillState): state is UnmanageableSkillState {
  return (
    state === "symlink" ||
    state === "symlinked-parent" ||
    state === "non-directory" ||
    state === "blocked-parent"
  );
}

function addVersionMessages(
  cli: CliVersionReport,
  guidance: UpgradeGuidance,
  messages: string[],
): void {
  if (cli.status === "outdated") {
    messages.push(
      `The running binary is older than the latest stable release. DocBridge does not upgrade itself: run \`${guidance.primaryCommand}\`, then re-run \`docbridge upgrade\` so managed assets are reconciled from the new binary.`,
    );
    return;
  }
  if (cli.status === "unknown") {
    messages.push(
      "The latest stable version could not be determined, so only local asset state is reported.",
    );
  }
}

function buildNextSteps(input: {
  mode: UpgradeMode;
  cli: CliVersionReport;
  options: UpgradeOptions;
  pending: string[];
}): string[] {
  const nextSteps: string[] = [];

  if (input.cli.status === "outdated") {
    nextSteps.push("Upgrade the CLI with the command above, then re-run `docbridge upgrade`.");
  }
  if (input.mode === "check") {
    nextSteps.push(
      "Run `docbridge upgrade --dry-run` to see the operations that would be applied.",
    );
  }
  if (input.pending.length > 0) {
    nextSteps.push("Re-run with --force to apply the pending migrations listed above.");
  }
  if (input.mode === "apply" && input.options.dryRun) {
    nextSteps.push("Re-run without --dry-run to apply the plan.");
  }

  return nextSteps;
}

/** Render the plan as the command's human-readable output. */
export function formatUpgradePlan(plan: UpgradePlan): string {
  const lines: string[] = [
    `DocBridge ${plan.cli.current} (latest stable: ${plan.cli.latest ?? "unknown"})`,
    `Status: ${plan.cli.status}`,
    ...formatUpgradeGuidance(plan.guidance),
  ];

  if (plan.messages.length > 0) {
    lines.push("", ...plan.messages);
  }

  appendSection(lines, "Managed skills:", plan.managedSkills.flatMap(formatManagedSkill));
  appendSection(
    lines,
    "Legacy skills:",
    plan.legacySkills.map((legacy) => `- ${legacy.path} (${legacy.kind})`),
  );
  appendSection(
    lines,
    "Operations:",
    plan.operations.map((operation) => formatFileOp(operation)),
  );
  appendSection(
    lines,
    "Pending migration:",
    plan.pending.map((entry) => `- ${entry}`),
  );
  appendSection(
    lines,
    "Next steps:",
    plan.nextSteps.map((step) => `- ${step}`),
  );

  return `${lines.join("\n")}\n`;
}

function formatManagedSkill(report: ManagedSkillReport): string[] {
  const lines = [`- ${report.path}: ${report.state}`];
  appendFileList(lines, "changed", report.modifiedFiles);
  appendFileList(lines, "missing", report.missingFiles);
  appendFileList(lines, "extra", report.extraFiles);
  return lines;
}

function appendFileList(lines: string[], label: string, files: string[]): void {
  if (files.length > 0) {
    lines.push(`    ${label}: ${files.join(", ")}`);
  }
}

function appendSection(lines: string[], heading: string, entries: string[]): void {
  if (entries.length === 0) {
    return;
  }
  lines.push("", heading, ...entries);
}

function toRootRelative(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split("\\").join("/");
}
