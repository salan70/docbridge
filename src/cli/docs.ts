import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolvePackageRoot } from "../core/init-plan";
import { scanMarkdown } from "../core/markdown";
import { CliError, commandHelpGuidance } from "./errors";
import type { CliIo } from "./index";

export type DocumentationSummary = {
  name: string;
  description: string;
};

export type DocumentationReader = {
  list(): DocumentationSummary[];
  show(name: string): string | undefined;
};

export type DocsCommand = { kind: "list"; json: boolean } | { kind: "show"; name: string };

const SHOW_HELP = "Run `docbridge docs show <name>` to read a document.";
const DOCUMENTATION_UNAVAILABLE = "Documentation is unavailable in this installation.";
const DOCUMENTATION_REINSTALL_GUIDANCE = [
  "Reinstall DocBridge so the packaged documentation is restored, then retry:",
  "",
  "  npm install docbridge",
].join("\n");

type ParsedDocument = DocumentationSummary & { content: string };

function documentationUnavailableError(): CliError {
  return new CliError(DOCUMENTATION_UNAVAILABLE, DOCUMENTATION_REINSTALL_GUIDANCE);
}

function parseDescription(name: string, frontmatter: string): string {
  const rawDescription = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (rawDescription === undefined || rawDescription.length === 0) {
    throw new Error(`Documentation file ${name}.md is missing a description.`);
  }

  if (rawDescription.startsWith('"') && rawDescription.endsWith('"')) {
    const description = JSON.parse(rawDescription) as unknown;
    if (typeof description === "string" && description.length > 0) {
      return description;
    }
  }

  return rawDescription;
}

function hideLinkAnnotations(name: string, content: string): string {
  const annotationLines = new Set(
    scanMarkdown(`docs/user/${name}.md`, content).links.map((link) => link.location.line),
  );
  return content
    .split("\n")
    .filter((_, index) => !annotationLines.has(index + 1))
    .join("\n");
}

function parseDocument(name: string, source: string): ParsedDocument {
  if (!source.startsWith("---\n")) {
    throw new Error(`Documentation file ${name}.md is missing YAML frontmatter.`);
  }

  const frontmatterEnd = source.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error(`Documentation file ${name}.md has invalid YAML frontmatter.`);
  }

  const frontmatter = source.slice(4, frontmatterEnd);
  const description = parseDescription(name, frontmatter);

  const contentAfterFrontmatter = source.slice(frontmatterEnd + "\n---\n".length);
  const content = contentAfterFrontmatter.startsWith("\n")
    ? contentAfterFrontmatter.slice(1)
    : contentAfterFrontmatter;

  return {
    name,
    description,
    content: hideLinkAnnotations(name, content),
  };
}

/**
 * Read task-oriented documentation from the installed package.
 */
export function createFileDocumentationReader(packageRoot: string): DocumentationReader {
  const docsRoot = join(packageRoot, "docs", "user");

  function documents(): ParsedDocument[] {
    let fileNames: string[];
    try {
      fileNames = readdirSync(docsRoot)
        .filter((fileName) => fileName.endsWith(".md"))
        .toSorted();
    } catch {
      throw documentationUnavailableError();
    }

    if (fileNames.length === 0) {
      throw documentationUnavailableError();
    }

    return fileNames.map((fileName) => {
      const name = fileName.slice(0, -".md".length);
      return parseDocument(name, readFileSync(join(docsRoot, fileName), "utf8"));
    });
  }

  return {
    list: () => documents().map(({ name, description }) => ({ name, description })),
    show: (name) => documents().find((document) => document.name === name)?.content,
  };
}

export function parseDocsCommand(args: string[]): DocsCommand {
  // Unlike the flat flag commands, `docs` has a verb-specific grammar:
  // `list` accepts --json while `show` requires exactly one name. Keeping that
  // grammar here avoids pretending it is the same positional-options shape.
  const [operation, ...rest] = args;

  if (operation === "list") {
    let json = false;
    for (const arg of rest) {
      if (arg === "--json") {
        json = true;
        continue;
      }
      throw new CliError(`Unknown option: ${arg}`, commandHelpGuidance("docs"));
    }
    return { kind: "list", json };
  }

  if (operation === "show") {
    const [name, ...extra] = rest;
    if (name === undefined || name.startsWith("--")) {
      throw new CliError("docs show requires a document name.", commandHelpGuidance("docs"));
    }
    if (extra.length > 0) {
      throw new CliError(`Unexpected argument: ${extra[0] ?? ""}`, commandHelpGuidance("docs"));
    }
    return { kind: "show", name };
  }

  throw new CliError(
    operation === undefined
      ? "docs requires list or show."
      : `Unknown docs operation: ${operation}`,
    commandHelpGuidance("docs"),
  );
}

/**
 * List or print the user documentation shipped with DocBridge.
 *
 * @doc docs/specs/cli.md#documentation-commands
 */
export function runDocs(
  command: DocsCommand,
  io: CliIo,
  reader: DocumentationReader = createFileDocumentationReader(resolvePackageRoot()),
): number {
  if (command.kind === "list") {
    const documents = reader.list();
    if (command.json) {
      io.stdout(`${JSON.stringify({ documents, help: SHOW_HELP }, null, 2)}\n`);
      return 0;
    }

    const width = Math.max(...documents.map(({ name }) => name.length)) + 2;
    const lines = documents.map(({ name, description }) => `${name.padEnd(width)}${description}`);
    io.stdout(`${lines.join("\n")}\n\n${SHOW_HELP}\n`);
    return 0;
  }

  const content = reader.show(command.name);
  if (content === undefined) {
    const names = reader.list().map(({ name }) => name);
    throw new CliError(
      `Unknown documentation name: ${command.name}`,
      `Available names:\n  ${names.join(", ")}\n\n${SHOW_HELP}`,
    );
  }
  io.stdout(content);
  return 0;
}
