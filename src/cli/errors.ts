/** A CLI invocation error with optional human-readable recovery guidance. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly guidance?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Errors raised while parsing or running the init commands. */
export class InitCliError extends CliError {
  constructor(message: string, guidance?: string) {
    super(message, guidance);
    this.name = "InitCliError";
  }
}

/** A core diagnostic dump that must remain byte-for-byte free of CLI decoration. */
export class DiagnosticOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosticOutputError";
  }
}

export function commandHelpGuidance(command: string): string {
  return `Run \`docbridge ${command} --help\` for command usage.`;
}

export function rootPathGuidance(command: string): string {
  return [
    "Provide a project root path:",
    "",
    `  docbridge ${command} --root .`,
    "",
    commandHelpGuidance(command),
  ].join("\n");
}

export function missingInputGuidance(command: "related" | "context"): string {
  return [
    "Provide file paths as arguments:",
    "",
    `  docbridge ${command} src/auth.ts`,
    "",
    "Or read newline-separated paths from stdin:",
    "",
    `  git diff --name-only | docbridge ${command} --stdin`,
    "",
    commandHelpGuidance(command),
  ].join("\n");
}

export function agentTargetGuidance(command: "init" | "init-with-agent"): string {
  return [
    "Provide an agent target:",
    "",
    `  docbridge ${command} --agent-target codex`,
    "",
    commandHelpGuidance(command),
  ].join("\n");
}

export function includeContentGuidance(): string {
  return [
    "Use --include-content together with --json:",
    "",
    "  docbridge graph --json --include-content",
    "",
    commandHelpGuidance("graph"),
  ].join("\n");
}

export function configSetupGuidance(): string {
  return [
    "Run one of:",
    "",
    "  docbridge init",
    "  docbridge init --dry-run",
    "",
    "For agent-guided adoption:",
    "",
    "  docbridge init-with-agent",
  ].join("\n");
}

export function configRepairGuidance(): string {
  return "Repair or delete docbridge.config.json, then re-run `docbridge check`.";
}

/** Render a CLI invocation error with its stable first-line prefix. */
export function formatCliError(error: unknown): string {
  if (!(error instanceof CliError)) {
    return error instanceof Error ? error.message : String(error);
  }

  if (error.guidance === undefined) {
    return `Error: ${error.message}`;
  }

  return [`Error: ${error.message}`, "", error.guidance].join("\n");
}
