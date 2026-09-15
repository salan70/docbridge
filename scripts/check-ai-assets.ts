#!/usr/bin/env bun

import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const codexTree = ".agents/skills";
const claudeTree = ".claude/skills";

/**
 * Skill directories that are shared instead of duplicated. Each key must stay a
 * symlink to its value so the two trees cannot drift apart for that skill.
 */
const sharedSkills: Record<string, string> = {
  [`${codexTree}/docbridge`]: "templates/skills/docbridge",
  [`${claudeTree}/concise-writing`]: `${codexTree}/concise-writing`,
  [`${claudeTree}/docbridge`]: "templates/skills/docbridge",
};

/** Configurations whose exclusion list must never skip a skill tree. */
const exclusionConfigs = [
  { path: ".oxfmtrc.json", format: "json", key: "ignorePatterns" },
  { path: ".oxlintrc.json", format: "json", key: "ignorePatterns" },
  { path: ".rumdl.toml", format: "toml", key: "exclude" },
] as const;

export function checkAiAssets(root: string): string[] {
  const errors: string[] = [];
  checkSharedSkills(root, errors);
  checkDuplicatedSkills(root, errors);
  checkExclusions(root, errors);
  return errors;
}

function checkSharedSkills(root: string, errors: string[]): void {
  for (const [skillPath, target] of Object.entries(sharedSkills)) {
    const resolved = resolvePath(root, skillPath);
    const expected = resolvePath(root, target);
    if (resolved === undefined || expected === undefined || resolved !== expected) {
      errors.push(`${skillPath} must be a symlink to ${target}.`);
    }
  }
}

function checkDuplicatedSkills(root: string, errors: string[]): void {
  const codexSkills = skillNames(root, codexTree);
  const claudeSkills = skillNames(root, claudeTree);

  for (const name of union(codexSkills, claudeSkills)) {
    if (!claudeSkills.has(name)) {
      errors.push(`${name} is missing from ${claudeTree}/.`);
      continue;
    }
    if (!codexSkills.has(name)) {
      errors.push(`${name} is missing from ${codexTree}/.`);
      continue;
    }
    compareSkill(root, name, errors);
  }
}

function compareSkill(root: string, name: string, errors: string[]): void {
  if (isSharedSkill(name)) {
    return;
  }

  const symlinks = [`${codexTree}/${name}`, `${claudeTree}/${name}`].filter((skillPath) =>
    isSymbolicLink(join(root, skillPath)),
  );
  if (symlinks.length > 0) {
    for (const skillPath of symlinks) {
      errors.push(`${skillPath} must be a directory, not a symlink.`);
    }
    return;
  }

  const codexDirectory = resolvePath(root, `${codexTree}/${name}`);
  const claudeDirectory = resolvePath(root, `${claudeTree}/${name}`);
  if (codexDirectory === undefined || claudeDirectory === undefined) {
    return;
  }

  const codexFiles = skillFiles(codexDirectory);
  const claudeFiles = skillFiles(claudeDirectory);
  for (const file of union(codexFiles, claudeFiles)) {
    if (!claudeFiles.has(file)) {
      errors.push(`${name}/${file} is missing from ${claudeTree}/.`);
    } else if (!codexFiles.has(file)) {
      errors.push(`${name}/${file} is missing from ${codexTree}/.`);
    } else if (
      !readFileSync(join(codexDirectory, file)).equals(readFileSync(join(claudeDirectory, file)))
    ) {
      errors.push(`${name}/${file} differs between ${codexTree}/ and ${claudeTree}/.`);
    }
  }
}

function checkExclusions(root: string, errors: string[]): void {
  for (const config of exclusionConfigs) {
    const content = readTextFile(join(root, config.path));
    if (content === undefined) {
      errors.push(`${config.path} is missing.`);
      continue;
    }
    const patterns =
      config.format === "json"
        ? jsonPatterns(content, config.key)
        : tomlPatterns(content, config.key);
    for (const pattern of patterns) {
      if (coversSkillTree(pattern)) {
        errors.push(
          `${config.path} excludes ${JSON.stringify(pattern)}; both skill trees must stay formatted and linted.`,
        );
      }
    }
  }
}

/**
 * Report whether an ignore pattern would hide part of a skill tree. A pattern
 * covers a tree when it matches a file inside it, or when it names one of its
 * parent directories, so a broad glob such as `.claude/**` is caught too.
 */
function coversSkillTree(pattern: string): boolean {
  const probes = [codexTree, claudeTree].flatMap((tree) => [
    `${tree}/probe/SKILL.md`,
    `${tree}/probe/references/probe.md`,
  ]);
  try {
    const glob = new Bun.Glob(pattern);
    if (probes.some((probe) => glob.match(probe))) {
      return true;
    }
  } catch {
    // An unparsable pattern still gets the directory-prefix test below.
  }
  const directory = pattern.replace(/\/\*+$/, "");
  return probes.some((probe) => probe.startsWith(`${directory}/`));
}

function jsonPatterns(content: string, key: string): string[] {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const value = (parsed as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function tomlPatterns(content: string, key: string): string[] {
  const array = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(content)?.[1];
  if (array === undefined) {
    return [];
  }
  return [...array.matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2] ?? "");
}

function skillNames(root: string, tree: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readDirectory(join(root, tree))) {
    if (isDirectory(join(root, tree, entry))) {
      names.add(entry);
    }
  }
  return names;
}

function skillFiles(directory: string): Set<string> {
  const files = new Set<string>();
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    for (const entry of readDirectory(current)) {
      const entryPath = join(current, entry);
      if (isDirectory(entryPath)) {
        pending.push(entryPath);
      } else {
        files.add(relative(directory, entryPath).split(sep).join("/"));
      }
    }
  }
  return files;
}

function readDirectory(directory: string): string[] {
  try {
    return readdirSync(directory).toSorted();
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Report whether either tree declares this skill as shared instead of duplicated. */
function isSharedSkill(name: string): boolean {
  return (
    sharedSkills[`${codexTree}/${name}`] !== undefined ||
    sharedSkills[`${claudeTree}/${name}`] !== undefined
  );
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Resolve a repository-relative path through symlinks, or `undefined` when it does not exist. */
function resolvePath(root: string, path: string): string | undefined {
  try {
    return realpathSync(resolve(root, path));
  } catch {
    return undefined;
  }
}

function union(left: Set<string>, right: Set<string>): string[] {
  return [...new Set([...left, ...right])].toSorted();
}

if (import.meta.main) {
  const errors = checkAiAssets(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }
  console.log("Claude and Codex AI assets are in sync.");
}
