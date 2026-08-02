/**
 * Help text for the global entry point and for every subcommand.
 *
 * Option tables are declared once here and rendered into both the global help
 * and the per-command help, so `docbridge --help` and
 * `docbridge <command> --help` cannot drift apart.
 */

export const SUBCOMMANDS = [
  "check",
  "related",
  "context",
  "graph",
  "docs",
  "init",
  "init-with-agent",
  "lsp",
] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

type OptionDoc = {
  /** Flag as it appears on the command line, including any value placeholder. */
  flag: string;
  /** One-line description; wrapped lines are indented by the renderer. */
  description: string;
};

type CommandDoc = {
  /** Argument summary appended to `docbridge <command>` in the usage line. */
  usage: string;
  /** One-line summary shown in the global help command list. */
  summary: string;
  /** Multi-line description that states when to use the command. */
  description: string;
  options: OptionDoc[];
};

const ROOT_OPTION: OptionDoc = {
  flag: "--root <path>",
  description: "Project root to scan. Defaults to current directory.",
};

const JSON_OPTION: OptionDoc = {
  flag: "--json",
  description: "Emit machine-readable JSON.",
};

const STDIN_OPTION: OptionDoc = {
  flag: "--stdin",
  description: "Read newline-separated file paths from stdin.",
};

const HELP_OPTION: OptionDoc = {
  flag: "--help, -h",
  description: "Print this help text.",
};

const INIT_OPTIONS: OptionDoc[] = [
  {
    flag: "--root <path>",
    description: "Project root to set up. Defaults to current directory.",
  },
  { flag: "--yes", description: "Accept safe defaults without prompting." },
  {
    flag: "--dry-run",
    description: "Print planned file operations without writing files.",
  },
  { flag: "--force", description: "Overwrite existing installed skills." },
];

const COMMAND_DOCS: Record<Subcommand, CommandDoc> = {
  check: {
    usage: "[options]",
    summary: "Use before committing or in CI to validate every link.",
    description: [
      "Validate every @doc and @code annotation in the project and report the",
      "diagnostics.",
      "Use it as the quality gate: in CI, in a pre-commit hook, or after editing",
      "annotations. It exits 1 when there is at least one error.",
    ].join("\n"),
    options: [
      ROOT_OPTION,
      JSON_OPTION,
      {
        flag: "--audit",
        description: "Include audit diagnostics: undocumented_symbol and unlinked_doc_section.",
      },
    ],
  },
  related: {
    usage: "[options] [files...]",
    summary: "Use after changing files to list their linked counterparts.",
    description: [
      "List which files are linked to the given files, without printing their",
      "content.",
      "Use it to decide what else a change should touch; add --gate to fail when a",
      "counterpart is missing from the change set. Reach for `context` instead when",
      "the counterpart content itself is needed.",
    ].join("\n"),
    options: [
      ROOT_OPTION,
      JSON_OPTION,
      STDIN_OPTION,
      {
        flag: "--gate",
        description: "Report counterparts that are not in the change set and exit 1 if any.",
      },
    ],
  },
  context: {
    usage: "[options] [files...]",
    summary: "Use before editing a linked file to read its counterpart content.",
    description: [
      "Print the content of the counterparts linked from the given files.",
      "Use it before modifying a linked code or Markdown file, so the change can be",
      "reconciled against its counterpart. The default Markdown output is suitable",
      "for inclusion in an agent prompt.",
    ].join("\n"),
    options: [ROOT_OPTION, JSON_OPTION, STDIN_OPTION],
  },
  graph: {
    usage: "[options] [files...]",
    summary: "Use to inspect the whole link structure, or to feed it to a tool.",
    description: [
      "Print the resolved link graph: endpoints and the links between them.",
      "Use it to inspect the link structure as a whole, or to feed link data to a",
      "tool. Passing files narrows the graph to them and their direct counterparts.",
    ].join("\n"),
    options: [
      ROOT_OPTION,
      JSON_OPTION,
      {
        flag: "--include-content",
        description: "Include lightweight node content. Requires --json.",
      },
      STDIN_OPTION,
    ],
  },
  docs: {
    usage: "list [--json] | show <name>",
    summary: "Use to read version-matched DocBridge documentation.",
    description: [
      "List or read the task-oriented documentation shipped with DocBridge.",
      "Use it when you need offline guidance that matches the installed version.",
      "Pass --json only to the list operation for machine-readable metadata.",
    ].join("\n"),
    options: [JSON_OPTION],
  },
  init: {
    usage: "[options]",
    summary: "Use once per project to set up config and agent skills.",
    description: [
      "Create docbridge.config.json and install the DocBridge agent skills.",
      "Use it once per project, when adopting DocBridge. Run it with --dry-run",
      "first to see what would be written.",
    ].join("\n"),
    options: [
      ...INIT_OPTIONS,
      {
        flag: "--agent-target <target>",
        description: "Agent target: codex, claude, both, or none.",
      },
    ],
  },
  "init-with-agent": {
    usage: "[options]",
    summary: "Use to let a coding agent decide the setup instead of `init`.",
    description: [
      "Install the docbridge-adopt skill and print the commands that let a coding",
      "agent finish the setup.",
      "Use it instead of `init` when an agent should decide the configuration",
      "rather than accepting the defaults.",
    ].join("\n"),
    options: [
      ...INIT_OPTIONS,
      {
        flag: "--agent-target <target>",
        description: "Agent target: codex, claude, or both.",
      },
    ],
  },
  lsp: {
    usage: "",
    summary: "Use from an editor to get link navigation and diagnostics.",
    description: [
      "Run the DocBridge Language Server over stdio.",
      "Use it from an editor or LSP client configuration, not interactively. The",
      "command takes no options.",
    ].join("\n"),
    options: [],
  },
};

function renderOptions(options: OptionDoc[]): string {
  const width = Math.max(...options.map((option) => option.flag.length)) + 2;

  return options.map((option) => `  ${option.flag.padEnd(width)}${option.description}`).join("\n");
}

function usageLine(command: Subcommand): string {
  const { usage } = COMMAND_DOCS[command];
  return usage.length > 0 ? `docbridge ${command} ${usage}` : `docbridge ${command}`;
}

function globalUsage(command: Subcommand): string {
  const { options } = COMMAND_DOCS[command];
  const flags = options.map((option) => `[${option.flag}]`).join(" ");
  const positional = COMMAND_DOCS[command].usage.includes("[files...]") ? " [files...]" : "";
  return `  docbridge ${command}${flags.length > 0 ? ` ${flags}` : ""}${positional}`;
}

function commandList(): string {
  const width = Math.max(...SUBCOMMANDS.map((command) => command.length)) + 2;
  return SUBCOMMANDS.map(
    (command) => `  ${command.padEnd(width)}${COMMAND_DOCS[command].summary}`,
  ).join("\n");
}

const GLOBAL_OPTION_SECTIONS = (["check", "related", "context", "graph", "docs", "init"] as const)
  .map((command) => {
    const label = `${command.charAt(0).toUpperCase()}${command.slice(1)}`;
    return `${label} options:\n${renderOptions(COMMAND_DOCS[command].options)}`;
  })
  .join("\n\n");

export const GLOBAL_HELP = `DocBridge

Usage:
  docbridge [--version] [--help]
${SUBCOMMANDS.map(globalUsage).join("\n")}

Commands:
${commandList()}

Run \`docbridge <command> --help\` for the full description of a command.

Global options:
  --version, -v  Print the DocBridge version.
  --help, -h     Print this help text.

${GLOBAL_OPTION_SECTIONS}
`;

/**
 * Help text for a single subcommand, printed for `docbridge <command> --help`.
 *
 * @doc docs/specs/cli.md#help
 */
export function commandHelp(command: Subcommand): string {
  const doc = COMMAND_DOCS[command];
  const options = renderOptions([...doc.options, HELP_OPTION]);
  const description = doc.description
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

  return `Usage:
  ${usageLine(command)}

Description:
${description}

Options:
${options}
`;
}

export function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

/**
 * Report whether the argument list requests help. Checked before any option is
 * validated, so `docbridge context --nonexistent --help` prints help.
 */
export function hasHelpFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--help" || arg === "-h");
}
