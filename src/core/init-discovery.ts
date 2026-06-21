import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { collectFiles } from "./glob";
import type { CodeLanguage } from "./types";

export type AgentTarget = "codex" | "claude" | "both" | "none";

export type DocsScopeCandidate = {
  directory: string;
  pattern: string;
  score: number;
  fileCount: number;
};

export type DocsScopeDiscovery = {
  candidates: DocsScopeCandidate[];
  recommended: DocsScopeCandidate | undefined;
  ambiguous: boolean;
  message: string | undefined;
};

export type CodeLanguageCandidate = {
  language: CodeLanguage;
  patterns: string[];
  fileCount: number;
};

export type CodeScopeDiscovery = {
  languages: CodeLanguageCandidate[];
  ambiguous: boolean;
  message: string | undefined;
};

export type AgentTargetDiscovery = {
  hasAgentsDir: boolean;
  hasClaudeDir: boolean;
  defaultTarget: AgentTarget;
  recommendedTarget: AgentTarget;
  message: string | undefined;
};

export type RepositoryDiscovery = {
  docs: DocsScopeDiscovery;
  code: CodeScopeDiscovery;
  agent: AgentTargetDiscovery;
};

const HIGH_CONFIDENCE_DIR_NAMES = new Set([
  "docs/specs",
  "specs",
  "spec",
  "requirements",
  "design",
  "architecture",
  "adr",
  "decisions",
]);

const MEDIUM_CONFIDENCE_DIR_NAMES = new Set(["docs", "documentation", "doc"]);

const EXCLUDED_PROSE_BASENAMES = new Set([
  "readme.md",
  "changelog.md",
  "contributing.md",
  "license.md",
  "code_of_conduct.md",
  "security.md",
]);

const EXCLUDED_DIR_SEGMENTS = new Set([
  "runbook",
  "runbooks",
  "release",
  "releases",
  "changelog",
  "changelogs",
  "contributing",
]);

const IGNORED_WALK_SEGMENTS = new Set(["node_modules", ".git", "dist", "build"]);

const TYPESCRIPT_PATTERNS = [
  "src/**/*.ts",
  "lib/**/*.ts",
  "packages/*/src/**/*.ts",
  "apps/*/src/**/*.ts",
] as const;

const SWIFT_PATTERNS = ["Sources/**/*.swift", "*/Sources/**/*.swift"] as const;

const DART_PATTERNS = ["lib/**/*.dart"] as const;

const LANGUAGE_PATTERNS: Record<CodeLanguage, readonly string[]> = {
  typescript: TYPESCRIPT_PATTERNS,
  swift: SWIFT_PATTERNS,
  dart: DART_PATTERNS,
};

/**
 * Discover likely docs scope, supported code scope, and default agent target for
 * first-time DocBridge setup.
 *
 * @doc docs/specs/cli.md#init-command
 */
export function discoverRepository(projectRoot: string): RepositoryDiscovery {
  return {
    docs: discoverDocsScope(projectRoot),
    code: discoverCodeScope(projectRoot),
    agent: discoverAgentTarget(projectRoot),
  };
}

export function discoverDocsScope(projectRoot: string): DocsScopeDiscovery {
  const markdownFiles = collectMarkdownFiles(projectRoot);
  const eligible = markdownFiles.filter((filePath) => isEligibleDocsFile(filePath));

  if (eligible.length === 0) {
    return {
      candidates: [],
      recommended: undefined,
      ambiguous: true,
      message:
        "No specification-like Markdown files were found. Confirm docs scope before creating docbridge.config.json.",
    };
  }

  const grouped = new Map<string, string[]>();
  for (const filePath of eligible) {
    const directory = dirname(filePath);
    const existing = grouped.get(directory) ?? [];
    existing.push(filePath);
    grouped.set(directory, existing);
  }

  const candidates = [...grouped.entries()]
    .map(([directory, files]) => ({
      directory,
      pattern: `${directory}/**/*.md`,
      score: scoreDocsDirectory(directory),
      fileCount: files.length,
    }))
    .sort((left, right) =>
      right.score !== left.score
        ? right.score - left.score
        : left.directory.localeCompare(right.directory),
    );

  const topScore = candidates[0]?.score ?? 0;
  if (topScore === 0) {
    return {
      candidates,
      recommended: undefined,
      ambiguous: true,
      message:
        "Markdown files were found, but no likely specification directory was detected. Confirm docs scope before creating docbridge.config.json.",
    };
  }

  const topCandidates = candidates.filter((candidate) => candidate.score === topScore);
  if (topCandidates.length !== 1) {
    return {
      candidates,
      recommended: undefined,
      ambiguous: true,
      message:
        "Multiple likely docs directories were detected. Confirm docs scope before creating docbridge.config.json.",
    };
  }

  return {
    candidates,
    recommended: topCandidates[0],
    ambiguous: false,
    message: undefined,
  };
}

export function discoverCodeScope(projectRoot: string): CodeScopeDiscovery {
  const languages: CodeLanguageCandidate[] = [];

  for (const language of ["typescript", "swift", "dart"] as const) {
    const patterns = activeCodePatterns(projectRoot, language);
    if (patterns.length > 0) {
      languages.push({
        language,
        patterns,
        fileCount: countCodeFiles(projectRoot, patterns, language),
      });
    }
  }

  if (languages.length === 0) {
    return {
      languages: [],
      ambiguous: true,
      message:
        "No supported code files were detected. Confirm code scope before creating docbridge.config.json.",
    };
  }

  return {
    languages,
    ambiguous: false,
    message: undefined,
  };
}

export function discoverAgentTarget(projectRoot: string): AgentTargetDiscovery {
  const hasAgentsDir = existsSync(join(projectRoot, ".agents"));
  const hasClaudeDir = existsSync(join(projectRoot, ".claude"));

  let defaultTarget: AgentTarget = "none";
  let recommendedTarget: AgentTarget = "none";
  let message: string | undefined;

  if (hasAgentsDir && hasClaudeDir) {
    defaultTarget = "both";
    recommendedTarget = "both";
  } else if (hasAgentsDir) {
    defaultTarget = "codex";
    recommendedTarget = "codex";
  } else if (hasClaudeDir) {
    defaultTarget = "claude";
    recommendedTarget = "claude";
  } else {
    defaultTarget = "none";
    recommendedTarget = "codex";
    message =
      "No agent directory was detected. Interactive setup recommends Codex (.agents/skills/) after confirmation.";
  }

  return {
    hasAgentsDir,
    hasClaudeDir,
    defaultTarget,
    recommendedTarget,
    message,
  };
}

export function resolveAgentTargetForInit(
  discovery: AgentTargetDiscovery,
  options: { yes: boolean; explicitTarget: AgentTarget | undefined },
): { target: AgentTarget | undefined; error: string | undefined } {
  if (options.explicitTarget !== undefined) {
    return { target: options.explicitTarget, error: undefined };
  }
  if (options.yes) {
    return { target: discovery.defaultTarget, error: undefined };
  }
  return { target: discovery.recommendedTarget, error: undefined };
}

export function resolveAgentTargetForInitWithAgent(
  discovery: AgentTargetDiscovery,
  options: { yes: boolean; explicitTarget: AgentTarget | undefined },
): { target: AgentTarget | undefined; error: string | undefined } {
  if (options.explicitTarget !== undefined) {
    if (options.explicitTarget === "none") {
      return {
        target: undefined,
        error: "init-with-agent requires an agent target other than none.",
      };
    }
    return { target: options.explicitTarget, error: undefined };
  }
  if (discovery.defaultTarget === "none") {
    if (options.yes) {
      return {
        target: undefined,
        error:
          "init-with-agent --yes requires an explicit agent target when no .agents/ or .claude/ directory exists. Pass --agent-target codex, claude, or both.",
      };
    }
    return { target: discovery.recommendedTarget, error: undefined };
  }
  return { target: discovery.defaultTarget, error: undefined };
}

function collectMarkdownFiles(projectRoot: string, currentDir = "."): string[] {
  const absoluteDir = join(projectRoot, currentDir);
  let entries: string[];
  try {
    entries = readdirSync(absoluteDir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relPath = currentDir === "." ? entry : `${currentDir}/${entry}`;
    const segments = relPath.split("/");
    if (segments.some((segment) => IGNORED_WALK_SEGMENTS.has(segment) || segment.startsWith("."))) {
      continue;
    }

    const absolutePath = join(projectRoot, relPath);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      files.push(...collectMarkdownFiles(projectRoot, relPath));
      continue;
    }

    if (stats.isFile() && relPath.endsWith(".md")) {
      files.push(relPath);
    }
  }

  return files.sort();
}

function isEligibleDocsFile(filePath: string): boolean {
  if (EXCLUDED_PROSE_BASENAMES.has(basename(filePath).toLowerCase())) {
    return false;
  }

  const segments = filePath.split("/").map((segment) => segment.toLowerCase());
  return !segments.some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

function scoreDocsDirectory(directory: string): number {
  const normalized = directory.replace(/^\.\/?/, "");
  if (normalized === ".") {
    return 0;
  }

  const segments = normalized.split("/");
  let score = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const tail = segments.slice(index).join("/");
    if (HIGH_CONFIDENCE_DIR_NAMES.has(tail) || HIGH_CONFIDENCE_DIR_NAMES.has(segments[index] ?? "")) {
      score = Math.max(score, 2);
    } else if (
      MEDIUM_CONFIDENCE_DIR_NAMES.has(tail) ||
      MEDIUM_CONFIDENCE_DIR_NAMES.has(segments[index] ?? "")
    ) {
      score = Math.max(score, 1);
    }
  }

  return score;
}

function activeCodePatterns(projectRoot: string, language: CodeLanguage): string[] {
  return LANGUAGE_PATTERNS[language].filter(
    (pattern) => countCodeFiles(projectRoot, [pattern], language) > 0,
  );
}

function countCodeFiles(
  projectRoot: string,
  patterns: string[],
  language: CodeLanguage,
): number {
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const filePath of collectFiles(projectRoot, [pattern])) {
      if (!isExcludedCodeFile(filePath, language)) {
        seen.add(filePath);
      }
    }
  }
  return seen.size;
}

function isExcludedCodeFile(filePath: string, language: CodeLanguage): boolean {
  const lower = filePath.toLowerCase();
  const segments = filePath.split("/");

  if (language === "typescript") {
    if (lower.endsWith(".d.ts")) {
      return true;
    }
    if (
      lower.endsWith(".test.ts") ||
      lower.endsWith(".spec.ts") ||
      segments.includes("__tests__") ||
      segments.includes("tests") ||
      segments.includes("test")
    ) {
      return true;
    }
  }

  if (language === "swift") {
    if (
      lower.endsWith("tests.swift") ||
      segments.includes("Tests") ||
      segments.includes("tests")
    ) {
      return true;
    }
  }

  if (language === "dart") {
    if (lower.endsWith("_test.dart") || segments.includes("test")) {
      return true;
    }
  }

  if (
    segments.some((segment) =>
      ["generated", "gen", ".dart_tool", "build"].includes(segment.toLowerCase()),
    )
  ) {
    return true;
  }

  return lower.includes(".generated.");
}
