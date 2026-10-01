import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  hasExcludedSuffix,
  KNOWN_CODE_LANGUAGES,
  LANGUAGE_SUFFIXES,
} from "../config/code-language";
import type { CodeLanguage } from "../model/types";
import { collectFiles } from "../shared/glob";

export type AgentTarget = "codex" | "claude" | "both" | "none";

type DocsScopeCandidate = {
  directory: string;
  pattern: string;
  score: number;
  fileCount: number;
};

type DocsScopeDiscovery = {
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

type CodeScopeDiscovery = {
  languages: CodeLanguageCandidate[];
  ambiguous: boolean;
  message: string | undefined;
};

type AgentTargetDiscovery = {
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

// The conventional source roots of a TypeScript or JavaScript project, once per suffix.
const SCRIPT_SOURCE_ROOTS = ["src", "lib", "packages/*/src", "apps/*/src"] as const;

const TYPESCRIPT_PATTERNS = scriptPatterns("typescript");

const JAVASCRIPT_PATTERNS = scriptPatterns("javascript");

const SWIFT_PATTERNS = ["Sources/**/*.swift", "*/Sources/**/*.swift"] as const;

const DART_PATTERNS = ["lib/**/*.dart"] as const;

const RUST_PATTERNS = ["src/**/*.rs", "*/src/**/*.rs"] as const;

// The conventional Go layout; `vendor/` at the root is never a candidate.
const GO_PATTERNS = ["*.go", "cmd/**/*.go", "internal/**/*.go", "pkg/**/*.go"] as const;

const RUBY_PATTERNS = ["lib/**/*.rb", "app/**/*.rb"] as const;

// The Maven and Gradle source root, else `src`: only the first that holds files is proposed.
const JAVA_PATTERNS = ["src/main/java/**/*.java", "src/**/*.java"] as const;

// Python's candidates depend on which top-level directories are packages.
const LANGUAGE_PATTERNS: Record<Exclude<CodeLanguage, "python">, readonly string[]> = {
  typescript: TYPESCRIPT_PATTERNS,
  swift: SWIFT_PATTERNS,
  dart: DART_PATTERNS,
  rust: RUST_PATTERNS,
  go: GO_PATTERNS,
  javascript: JAVASCRIPT_PATTERNS,
  ruby: RUBY_PATTERNS,
  java: JAVA_PATTERNS,
};

// Path segments, or runs of segments such as `src/test`, that hold tests, build
// output, environments, or vendored code.
const EXCLUDED_CODE_SEGMENTS: Record<CodeLanguage, readonly string[]> = {
  typescript: ["__tests__", "tests", "test"],
  swift: ["Tests", "tests"],
  dart: ["test"],
  rust: ["target", "tests", "benches", "examples"],
  go: ["vendor", "testdata"],
  javascript: ["__tests__", "tests", "test"],
  python: ["tests", "venv", "dist", "site-packages"],
  ruby: ["spec", "test", "vendor"],
  java: ["target", "src/test"],
};

// Test file names, matched against the lowercased path.
const TEST_FILE_PATTERNS: Partial<Record<CodeLanguage, RegExp>> = {
  typescript: /\.(?:test|spec)\.[cm]?tsx?$/u,
  swift: /tests\.swift$/u,
  dart: /_test\.dart$/u,
  go: /_test\.go$/u,
  javascript: /\.(?:test|spec)\.[cm]?jsx?$/u,
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
    .toSorted((left, right) =>
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

  for (const language of KNOWN_CODE_LANGUAGES) {
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

  return files.toSorted();
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
    if (
      HIGH_CONFIDENCE_DIR_NAMES.has(tail) ||
      HIGH_CONFIDENCE_DIR_NAMES.has(segments[index] ?? "")
    ) {
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

/** Every source root of {@link SCRIPT_SOURCE_ROOTS} combined with every suffix of `language`. */
function scriptPatterns(language: CodeLanguage): string[] {
  return SCRIPT_SOURCE_ROOTS.flatMap((root) =>
    LANGUAGE_SUFFIXES[language].map((suffix) => `${root}/**/*${suffix}`),
  );
}

function activeCodePatterns(projectRoot: string, language: CodeLanguage): string[] {
  const candidates =
    language === "python" ? pythonPatterns(projectRoot) : LANGUAGE_PATTERNS[language];
  const active = candidates.filter(
    (pattern) => countCodeFiles(projectRoot, [pattern], language) > 0,
  );
  return language === "java" ? active.slice(0, 1) : active;
}

/** Every `.py` file under `src` and under each top-level directory that holds `__init__.py`. */
function pythonPatterns(projectRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const packages = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "src" &&
        !entry.name.startsWith(".") &&
        !IGNORED_WALK_SEGMENTS.has(entry.name) &&
        existsSync(join(projectRoot, entry.name, "__init__.py")),
    )
    .map((entry) => entry.name)
    .toSorted();
  return ["src/**/*.py", ...packages.map((name) => `${name}/**/*.py`)];
}

function countCodeFiles(projectRoot: string, patterns: string[], language: CodeLanguage): number {
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
  const delimited = `/${filePath}/`;

  if (
    hasExcludedSuffix(language, lower) ||
    TEST_FILE_PATTERNS[language]?.test(lower) === true ||
    EXCLUDED_CODE_SEGMENTS[language].some((run) => delimited.includes(`/${run}/`))
  ) {
    return true;
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
