import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocBridgeConfig } from "./config";
import { resolveConfig } from "./config";
import type {
  AgentTarget,
  CodeLanguageCandidate,
  DocsScopeCandidate,
  RepositoryDiscovery,
} from "./init-discovery";
import type { CodeLanguage } from "./types";

export type InitCommandKind = "init" | "init-with-agent";

export type InitSharedOptions = {
  root: string;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  agentTarget: AgentTarget | undefined;
};

export type FileOpAction = "create" | "skip" | "overwrite" | "would-create" | "would-overwrite";

export type PlannedFileOp = {
  action: FileOpAction;
  path: string;
  content?: string;
  reason?: string;
};

export type AgentGuidance = {
  agent: "codex" | "claude";
  destination: string;
  oneShotCommand: string;
  fallbackPrompt: string;
};

export type InitPlan = {
  command: InitCommandKind;
  configOps: PlannedFileOp[];
  skillOps: PlannedFileOp[];
  messages: string[];
  nextSteps: string[];
  agentGuidance: AgentGuidance[];
  exitCode: number;
};

export type ConfirmedScope = {
  docsPattern: string;
  languages: CodeLanguageCandidate[];
};

const CONFIG_FILE_NAME = "docbridge.config.json";

const INIT_SKILL_NAMES = [
  "docbridge-adopt",
  "docbridge-annotate",
  "docbridge-link",
  "docbridge-review",
  "docbridge-sync",
] as const;

const INIT_WITH_AGENT_SKILL_NAMES = ["docbridge-adopt"] as const;

/**
 * Build a deterministic init plan without writing files.
 *
 * @doc docs/specs/cli.md#init-command
 */
export function planInitCommand(input: {
  command: InitCommandKind;
  projectRoot: string;
  options: InitSharedOptions;
  discovery: RepositoryDiscovery;
  confirmedScope?: ConfirmedScope;
  packageRoot?: string;
}): InitPlan {
  const packageRoot = input.packageRoot ?? resolvePackageRoot();
  const existingConfig = readExistingConfig(input.projectRoot);
  const messages: string[] = [];
  const nextSteps: string[] = [];
  let exitCode = 0;

  const agentResolution =
    input.command === "init"
      ? resolveInitAgentTarget(input.discovery, input.options)
      : resolveInitWithAgentTarget(input.discovery, input.options);

  if (agentResolution.error !== undefined) {
    return {
      command: input.command,
      configOps: [],
      skillOps: [],
      messages: [agentResolution.error],
      nextSteps: [],
      agentGuidance: [],
      exitCode: 1,
    };
  }

  const agentTarget = agentResolution.target ?? "none";
  const configOps =
    input.command === "init"
      ? planConfigOperations({
          projectRoot: input.projectRoot,
          options: input.options,
          discovery: input.discovery,
          confirmedScope: input.confirmedScope,
          existingConfig,
          messages,
        })
      : [];

  if (configOps.some((operation) => operation.action === "create" || operation.action === "would-create")) {
    nextSteps.push("Review docbridge.config.json and adjust include.docs or include.code if needed.");
    nextSteps.push("Add @doc and @code annotations to link code and documentation.");
    nextSteps.push("Run docbridge check when links exist.");
  } else if (existingConfig.ok) {
    messages.push("Existing docbridge.config.json was left unchanged.");
    summarizeExistingConfig(existingConfig.config, messages);
  } else if (existingConfig.rawText !== undefined) {
    messages.push("Existing docbridge.config.json is invalid and was not modified.");
    for (const diagnostic of existingConfig.diagnostics) {
      messages.push(diagnostic.message);
    }
    messages.push("Repair the config manually or delete it before re-running init.");
    exitCode = 1;
  }

  const skillOps = planSkillOperations({
    command: input.command,
    projectRoot: input.projectRoot,
    packageRoot,
    agentTarget,
    options: input.options,
  });

  const agentGuidance =
    input.command === "init-with-agent" && agentTarget !== "none"
      ? buildAgentGuidance(input.projectRoot, agentTarget)
      : [];

  if (input.command === "init-with-agent") {
    nextSteps.push("Run the printed one-shot command or fallback prompt in your agent.");
    nextSteps.push("Let docbridge-adopt confirm scope and create or improve docbridge.config.json.");
  }

  if (
    input.options.yes &&
    input.command === "init" &&
    configOps.length === 0 &&
    existingConfig.rawText === undefined &&
    (input.discovery.docs.ambiguous || input.discovery.code.ambiguous)
  ) {
    exitCode = 1;
  }

  return {
    command: input.command,
    configOps,
    skillOps,
    messages,
    nextSteps,
    agentGuidance,
    exitCode,
  };
}

export function buildConfigFromScope(scope: ConfirmedScope): DocBridgeConfig {
  const code: DocBridgeConfig["include"]["code"] = {};
  for (const language of scope.languages) {
    code[language.language] = { patterns: [...language.patterns] };
  }

  return {
    include: {
      code,
      docs: [scope.docsPattern],
    },
  };
}

/**
 * Resolve the package directory that ships `templates/skills`.
 *
 * Source execution runs this module from `src/core/`, while the published CLI
 * runs the bundle from `dist/index.js`; the `templates/skills` tree sits at the
 * repository root in source and at the package root in the npm tarball. A fixed
 * relative offset cannot satisfy both depths, so walk up from the module's real
 * path (symlinks resolved, matching the npm `.bin` shim) until that tree is
 * found.
 */
export function resolvePackageRoot(moduleUrl: string = import.meta.url): string {
  const modulePath = fileURLToPath(moduleUrl);
  let resolved: string;
  try {
    resolved = realpathSync(modulePath);
  } catch {
    resolved = modulePath;
  }

  let dir = dirname(resolved);
  for (;;) {
    if (existsSync(join(dir, "templates", "skills"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return dir;
    }
    dir = parent;
  }
}

export function listDistributableSkills(packageRoot: string): string[] {
  const skillsRoot = join(packageRoot, "templates", "skills");
  let entries: string[];
  try {
    entries = readdirSync(skillsRoot);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.startsWith("docbridge-"))
    .filter((entry) => existsSync(join(skillsRoot, entry, "SKILL.md")))
    .sort();
}

export function formatInitPlan(plan: InitPlan): string {
  const lines: string[] = [];

  for (const message of plan.messages) {
    lines.push(message);
  }

  if (plan.configOps.length > 0) {
    lines.push("");
    lines.push("Config:");
    for (const operation of plan.configOps) {
      lines.push(formatFileOp(operation));
      if (operation.content !== undefined) {
        lines.push(operation.content);
      }
    }
  }

  if (plan.skillOps.length > 0) {
    lines.push("");
    lines.push("Skills:");
    for (const operation of plan.skillOps) {
      lines.push(formatFileOp(operation));
    }
  }

  if (plan.agentGuidance.length > 0) {
    lines.push("");
    lines.push("Agent setup:");
    for (const guidance of plan.agentGuidance) {
      lines.push("");
      lines.push(`${capitalize(guidance.agent)} destination: ${guidance.destination}`);
      lines.push(`One-shot command: ${guidance.oneShotCommand}`);
      lines.push("Fallback prompt:");
      lines.push(guidance.fallbackPrompt);
    }
  }

  if (plan.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of plan.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function planConfigOperations(input: {
  projectRoot: string;
  options: InitSharedOptions;
  discovery: RepositoryDiscovery;
  confirmedScope: ConfirmedScope | undefined;
  existingConfig: ExistingConfigState;
  messages: string[];
}): PlannedFileOp[] {
  if (input.existingConfig.rawText !== undefined) {
    return [];
  }

  const scope = input.confirmedScope ?? inferConfirmedScope(input.discovery, input.options);
  if (scope === undefined) {
    if (input.discovery.docs.message !== undefined) {
      input.messages.push(input.discovery.docs.message);
    }
    if (input.discovery.code.message !== undefined) {
      input.messages.push(input.discovery.code.message);
    }
    if (input.options.yes) {
      input.messages.push(
        "Automatic setup stopped because docs or code scope is ambiguous. Re-run interactively or confirm scope explicitly.",
      );
    }
    return [];
  }

  const config = buildConfigFromScope(scope);
  const content = `${JSON.stringify({ $schema: "./schemas/docbridge.schema.json", ...config }, null, 2)}\n`;
  const action = input.options.dryRun ? "would-create" : "create";

  input.messages.push(`Docs scope: ${scope.docsPattern}`);
  input.messages.push(
    `Code scope: ${scope.languages.map((language) => `${language.language} (${language.patterns.join(", ")})`).join("; ")}`,
  );

  return [
    {
      action,
      path: CONFIG_FILE_NAME,
      content,
      reason: "Create docbridge.config.json from discovered scope.",
    },
  ];
}

function inferConfirmedScope(
  discovery: RepositoryDiscovery,
  options: InitSharedOptions,
): ConfirmedScope | undefined {
  if (discovery.docs.ambiguous || discovery.code.ambiguous) {
    return undefined;
  }
  if (discovery.docs.recommended === undefined || discovery.code.languages.length === 0) {
    return undefined;
  }
  if (!options.yes) {
    return undefined;
  }

  return {
    docsPattern: discovery.docs.recommended.pattern,
    languages: discovery.code.languages,
  };
}

function planSkillOperations(input: {
  command: InitCommandKind;
  projectRoot: string;
  packageRoot: string;
  agentTarget: AgentTarget;
  options: InitSharedOptions;
}): PlannedFileOp[] {
  if (input.agentTarget === "none") {
    return [];
  }

  const skillNames =
    input.command === "init" ? [...INIT_SKILL_NAMES] : [...INIT_WITH_AGENT_SKILL_NAMES];
  const destinations = agentDestinations(input.agentTarget);
  const availableSkills = new Set(listDistributableSkills(input.packageRoot));
  const operations: PlannedFileOp[] = [];

  for (const destination of destinations) {
    for (const skillName of skillNames) {
      if (!availableSkills.has(skillName)) {
        continue;
      }

      const destinationDir = join(input.projectRoot, destination, skillName);
      const exists = existsSync(destinationDir);
      let action: FileOpAction;
      let reason: string;

      if (exists && input.options.force) {
        action = input.options.dryRun ? "would-overwrite" : "overwrite";
        reason = "Overwrite existing skill directory.";
      } else if (exists) {
        action = "skip";
        reason = "Skill directory already exists.";
      } else {
        action = input.options.dryRun ? "would-create" : "create";
        reason = "Install distributable skill template.";
      }

      operations.push({
        action,
        path: relative(input.projectRoot, destinationDir),
        reason,
      });
    }
  }

  return operations;
}

function buildAgentGuidance(projectRoot: string, agentTarget: AgentTarget): AgentGuidance[] {
  const guidance: AgentGuidance[] = [];

  if (agentTarget === "codex" || agentTarget === "both") {
    guidance.push({
      agent: "codex",
      destination: ".agents/skills/docbridge-adopt/",
      oneShotCommand: `cd ${projectRoot} && $docbridge_adopt_prompt`,
      fallbackPrompt: buildFallbackPrompt(projectRoot, "codex"),
    });
  }

  if (agentTarget === "claude" || agentTarget === "both") {
    guidance.push({
      agent: "claude",
      destination: ".claude/skills/docbridge-adopt/",
      oneShotCommand: `cd ${projectRoot} && /docbridge-adopt`,
      fallbackPrompt: buildFallbackPrompt(projectRoot, "claude"),
    });
  }

  for (const entry of guidance) {
    entry.oneShotCommand = entry.oneShotCommand.replace(
      "$docbridge_adopt_prompt",
      "codex --prompt \"Use the docbridge-adopt skill to adopt DocBridge in this repository.\"",
    );
  }

  return guidance;
}

function buildFallbackPrompt(projectRoot: string, agent: "codex" | "claude"): string {
  const invocation =
    agent === "claude"
      ? "Use the docbridge-adopt skill"
      : "Use the docbridge-adopt skill from .agents/skills/docbridge-adopt";
  return `${invocation} to adopt DocBridge in ${projectRoot}. Confirm docs and code scope, create or improve docbridge.config.json, and suggest the next linking steps.`;
}

function resolveInitAgentTarget(
  discovery: RepositoryDiscovery,
  options: InitSharedOptions,
): { target: AgentTarget | undefined; error: string | undefined } {
  if (options.agentTarget !== undefined) {
    return { target: options.agentTarget, error: undefined };
  }
  if (options.yes) {
    return { target: discovery.agent.defaultTarget, error: undefined };
  }
  return { target: discovery.agent.recommendedTarget, error: undefined };
}

function resolveInitWithAgentTarget(
  discovery: RepositoryDiscovery,
  options: InitSharedOptions,
): { target: AgentTarget | undefined; error: string | undefined } {
  if (options.agentTarget !== undefined) {
    if (options.agentTarget === "none") {
      return {
        target: undefined,
        error: "init-with-agent requires an agent target other than none.",
      };
    }
    return { target: options.agentTarget, error: undefined };
  }

  if (discovery.agent.defaultTarget === "none") {
    if (options.yes) {
      return {
        target: undefined,
        error:
          "init-with-agent --yes requires an explicit agent target when no .agents/ or .claude/ directory exists. Pass --agent-target codex, claude, or both.",
      };
    }
    return { target: discovery.agent.recommendedTarget, error: undefined };
  }

  return { target: discovery.agent.defaultTarget, error: undefined };
}

type ExistingConfigState = {
  rawText: string | undefined;
  ok: boolean;
  config: DocBridgeConfig;
  diagnostics: ReturnType<typeof resolveConfig>["diagnostics"];
};

function readExistingConfig(projectRoot: string): ExistingConfigState {
  const configPath = join(projectRoot, CONFIG_FILE_NAME);
  let rawText: string | undefined;
  try {
    rawText = readFileSync(configPath, "utf8");
  } catch {
    rawText = undefined;
  }

  const resolved = resolveConfig(rawText);
  return {
    rawText,
    ok: resolved.ok,
    config: resolved.config,
    diagnostics: resolved.diagnostics,
  };
}

function summarizeExistingConfig(config: DocBridgeConfig, messages: string[]): void {
  messages.push(`Docs scope: ${config.include.docs.join(", ")}`);
  const codeSummary = Object.entries(config.include.code)
    .map(([language, entry]) => `${language}: ${entry?.patterns.join(", ") ?? ""}`)
    .join("; ");
  messages.push(`Code scope: ${codeSummary}`);
}

function agentDestinations(agentTarget: AgentTarget): string[] {
  switch (agentTarget) {
    case "codex":
      return [".agents/skills"];
    case "claude":
      return [".claude/skills"];
    case "both":
      return [".agents/skills", ".claude/skills"];
    default:
      return [];
  }
}

function formatFileOp(operation: PlannedFileOp): string {
  const label =
    operation.action === "would-create"
      ? "would create"
      : operation.action === "would-overwrite"
        ? "would overwrite"
        : operation.action;
  const reason = operation.reason ? ` (${operation.reason})` : "";
  return `- ${label} ${operation.path}${reason}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function collectSkillTemplateFiles(packageRoot: string, skillName: string): string[] {
  const skillRoot = join(packageRoot, "templates", "skills", skillName);
  const files: string[] = [];
  walkSkillTree(skillRoot, skillRoot, files);
  return files.sort();
}

function walkSkillTree(root: string, currentDir: string, files: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      walkSkillTree(root, absolutePath, files);
      continue;
    }

    if (stats.isFile()) {
      files.push(relative(root, absolutePath));
    }
  }
}
