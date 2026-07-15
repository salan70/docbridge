import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { discoverRepository } from "../core/init-discovery";
import type { AgentTarget } from "../core/init-discovery";
import {
  buildConfigFromScope,
  formatInitPlan,
  planInitCommand,
  resolvePackageRoot,
  type ConfirmedScope,
  type InitCommandKind,
  type InitPlan,
  type InitSharedOptions,
  type PlannedFileOp,
} from "../core/init-plan";
import type { CliIo } from "./index";

class InitCliError extends Error {}

export type InitPrompts = {
  isInteractive: boolean;
  confirm(message: string, defaultValue?: boolean): boolean;
  select(message: string, choices: readonly string[], defaultChoice: string): string;
};

export type InitRuntime = {
  prompts: InitPrompts;
  packageRoot?: string;
};

const AGENT_TARGETS = new Set<AgentTarget>(["codex", "claude", "both", "none"]);

/**
 * Parse shared init command options.
 *
 * @doc docs/specs/cli.md#init-command
 */
export function parseInitOptions(args: string[], command: InitCommandKind): InitSharedOptions {
  const options: InitSharedOptions = {
    root: ".",
    yes: false,
    dryRun: false,
    force: false,
    agentTarget: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--yes") {
      options.yes = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--root") {
      const root = args[index + 1];
      if (root === undefined) {
        throw new InitCliError("--root requires a path.");
      }
      options.root = root;
      index += 1;
      continue;
    }

    if (arg === "--agent-target") {
      const target = args[index + 1];
      if (target === undefined) {
        throw new InitCliError("--agent-target requires a value.");
      }
      if (!AGENT_TARGETS.has(target as AgentTarget)) {
        throw new InitCliError(
          `Unknown agent target: ${target}. Supported values: codex, claude, both${command === "init" ? ", none" : ""}.`,
        );
      }
      if (command === "init-with-agent" && target === "none") {
        throw new InitCliError("init-with-agent requires an agent target other than none.");
      }
      options.agentTarget = target as AgentTarget;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new InitCliError(`Unknown option: ${arg}`);
    }

    throw new InitCliError(`Unexpected argument: ${arg}`);
  }

  return options;
}

export function createDefaultPrompts(isInteractive = process.stdin.isTTY): InitPrompts {
  return {
    isInteractive,
    confirm(message, defaultValue = true) {
      if (!isInteractive) {
        return defaultValue;
      }
      process.stdout.write(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"} `);
      const answer = readFileSync(0, "utf8").trim().toLowerCase();
      if (answer.length === 0) {
        return defaultValue;
      }
      return answer === "y" || answer === "yes";
    },
    select(message, choices, defaultChoice) {
      if (!isInteractive) {
        return defaultChoice;
      }
      process.stdout.write(`${message}\n`);
      for (const [index, choice] of choices.entries()) {
        process.stdout.write(`  ${index + 1}. ${choice}\n`);
      }
      process.stdout.write(`Choice [${defaultChoice}]: `);
      const answer = readFileSync(0, "utf8").trim();
      if (answer.length === 0) {
        return defaultChoice;
      }
      const numeric = Number.parseInt(answer, 10);
      if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
        return choices[numeric - 1] ?? defaultChoice;
      }
      if (choices.includes(answer)) {
        return answer;
      }
      return defaultChoice;
    },
  };
}

/**
 * Run CLI-driven first-time DocBridge setup.
 *
 * @doc docs/specs/cli.md#init-command
 */
export function runInit(
  options: InitSharedOptions,
  io: CliIo,
  runtime: InitRuntime = { prompts: createDefaultPrompts(false) },
): number {
  return runInitCommand("init", options, io, runtime);
}

/**
 * Prepare agent-guided adoption by installing docbridge-adopt and printing setup guidance.
 *
 * @doc docs/specs/cli.md#init-with-agent-command
 */
export function runInitWithAgent(
  options: InitSharedOptions,
  io: CliIo,
  runtime: InitRuntime = { prompts: createDefaultPrompts(false) },
): number {
  return runInitCommand("init-with-agent", options, io, runtime);
}

function runInitCommand(
  command: InitCommandKind,
  options: InitSharedOptions,
  io: CliIo,
  runtime: InitRuntime,
): number {
  const projectRoot = resolveProjectRoot(options.root);
  const discovery = discoverRepository(projectRoot);
  // init-with-agent never generates docbridge.config.json; scope confirmation
  // is deferred to the docbridge-adopt skill, so skip it here.
  const confirmedScope =
    command === "init"
      ? resolveConfirmedScope({
          command,
          discovery,
          options,
          prompts: runtime.prompts,
        })
      : undefined;

  const plan = planInitCommand({
    command,
    projectRoot,
    options,
    discovery,
    ...(confirmedScope !== undefined ? { confirmedScope } : {}),
    ...(runtime.packageRoot !== undefined ? { packageRoot: runtime.packageRoot } : {}),
  });

  if (!options.dryRun) {
    executePlan(projectRoot, plan, runtime.packageRoot ?? resolvePackageRoot());
  }

  io.stdout(formatInitPlan(plan));
  return plan.exitCode;
}

function resolveConfirmedScope(input: {
  command: InitCommandKind;
  discovery: ReturnType<typeof discoverRepository>;
  options: InitSharedOptions;
  prompts: InitPrompts;
}): ConfirmedScope | undefined {
  if (input.options.yes) {
    if (input.discovery.docs.ambiguous || input.discovery.code.ambiguous) {
      return undefined;
    }
    if (input.discovery.docs.recommended === undefined) {
      return undefined;
    }
    return {
      docsPattern: input.discovery.docs.recommended.pattern,
      languages: input.discovery.code.languages,
    };
  }

  if (!input.prompts.isInteractive) {
    throw new InitCliError(
      "Interactive setup requires a TTY. Re-run with --yes for non-interactive mode.",
    );
  }

  if (input.discovery.docs.ambiguous) {
    const choices = input.discovery.docs.candidates.map((candidate) => candidate.pattern);
    if (choices.length === 0) {
      throw new InitCliError(
        "Docs scope is ambiguous and no candidates were detected. Create docbridge.config.json manually.",
      );
    }
    const docsPattern = input.prompts.select("Choose docs scope:", choices, choices[0] ?? "");
    const languages = selectLanguages(input.discovery.code.languages, input.prompts);
    return { docsPattern, languages };
  }

  if (input.discovery.docs.recommended === undefined) {
    throw new InitCliError("Docs scope could not be determined.");
  }

  let docsPattern = input.discovery.docs.recommended.pattern;
  if (!input.prompts.confirm(`Use docs scope ${docsPattern}?`, true)) {
    const choices = input.discovery.docs.candidates.map((candidate) => candidate.pattern);
    docsPattern = input.prompts.select("Choose docs scope:", choices, docsPattern);
  }

  const languages = selectLanguages(input.discovery.code.languages, input.prompts);
  if (input.command === "init") {
    const recommendedTarget = input.discovery.agent.recommendedTarget;
    if (
      input.options.agentTarget === undefined &&
      input.discovery.agent.defaultTarget === "none" &&
      !input.prompts.confirm(
        `Install Codex skills under .agents/skills/?`,
        recommendedTarget === "codex",
      )
    ) {
      input.options.agentTarget = "none";
    }
  }

  return {
    docsPattern,
    languages,
  };
}

function selectLanguages(
  languages: ConfirmedScope["languages"],
  prompts: InitPrompts,
): ConfirmedScope["languages"] {
  if (languages.length <= 1) {
    return languages;
  }

  const selected = [...languages];
  for (const language of languages) {
    const keep = prompts.confirm(
      `Include ${language.language} code scope (${language.patterns.join(", ")})?`,
      true,
    );
    if (!keep) {
      const index = selected.findIndex((entry) => entry.language === language.language);
      if (index >= 0) {
        selected.splice(index, 1);
      }
    }
  }

  if (selected.length === 0) {
    throw new InitCliError("At least one supported code language must remain in scope.");
  }

  return selected;
}

function executePlan(projectRoot: string, plan: InitPlan, packageRoot: string): void {
  for (const operation of plan.configOps) {
    executeFileOperation(projectRoot, operation);
  }

  for (const operation of plan.skillOps) {
    if (operation.action === "skip") {
      continue;
    }
    executeSkillOperation(projectRoot, packageRoot, operation);
  }
}

function executeFileOperation(projectRoot: string, operation: PlannedFileOp): void {
  const absolutePath = join(projectRoot, operation.path);
  if (operation.action === "create" && operation.content !== undefined) {
    writeFileSync(absolutePath, operation.content, "utf8");
  }
  if (operation.action === "overwrite" && operation.content !== undefined) {
    writeFileSync(absolutePath, operation.content, "utf8");
  }
}

function executeSkillOperation(
  projectRoot: string,
  packageRoot: string,
  operation: PlannedFileOp,
): void {
  if (operation.action !== "create" && operation.action !== "overwrite") {
    return;
  }

  const skillName = operation.path.split("/").at(-1);
  if (skillName === undefined) {
    return;
  }

  const sourceDir = join(packageRoot, "templates", "skills", skillName);
  const destinationDir = join(projectRoot, operation.path);
  mkdirSync(destinationDir, { recursive: true });
  cpSync(sourceDir, destinationDir, { recursive: true, force: true });
}

function resolveProjectRoot(root: string): string {
  const projectRoot = resolve(root);

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new InitCliError(`Root path does not exist: ${root}`);
  }

  if (!stats.isDirectory()) {
    throw new InitCliError(`Root path is not a directory: ${root}`);
  }

  return projectRoot;
}

export { InitCliError, buildConfigFromScope };
