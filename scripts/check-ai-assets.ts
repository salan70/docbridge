#!/usr/bin/env bun

import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const codexTree = ".agents/skills";
const claudeTree = ".claude/skills";

/** The distributable skill, which the Codex tree links instead of copying. */
const templateSkill = { path: `${codexTree}/docbridge`, target: "templates/skills/docbridge" };

/** Configurations whose exclusion list must never skip a skill tree. */
const exclusionConfigs = [
  { path: ".oxfmtrc.json", format: "json", key: "ignorePatterns" },
  { path: ".oxlintrc.json", format: "json", key: "ignorePatterns" },
  { path: ".rumdl.toml", format: "toml", key: "exclude" },
] as const;

/**
 * Check the skill layout: every skill lives once under the Codex tree, and the
 * Claude tree holds only symlinks that resolve to the same skill.
 */
export function checkAiAssets(root: string): string[] {
  const errors: string[] = [];
  checkTemplateSkill(root, errors);
  checkLinkedSkills(root, errors);
  checkExclusions(root, errors);
  return errors;
}

function checkTemplateSkill(root: string, errors: string[]): void {
  const resolved = resolvePath(root, templateSkill.path);
  if (resolved === undefined || resolved !== resolvePath(root, templateSkill.target)) {
    errors.push(`${templateSkill.path} must be a symlink to ${templateSkill.target}.`);
  }
}

function checkLinkedSkills(root: string, errors: string[]): void {
  const codexSkills = skillNames(root, codexTree);
  const claudeSkills = skillNames(root, claudeTree);

  for (const name of union(codexSkills, claudeSkills)) {
    if (!codexSkills.has(name)) {
      errors.push(`${name} is missing from ${codexTree}/.`);
      continue;
    }
    if (!claudeSkills.has(name)) {
      errors.push(`${name} is missing from ${claudeTree}/.`);
      continue;
    }
    const claudePath = `${claudeTree}/${name}`;
    const resolved = resolvePath(root, claudePath);
    if (
      !isSymbolicLink(join(root, claudePath)) ||
      resolved === undefined ||
      resolved !== resolvePath(root, `${codexTree}/${name}`)
    ) {
      errors.push(`${claudePath} must be a symlink to ${codexTree}/${name}.`);
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
  return new Set(readDirectory(join(root, tree)));
}

function readDirectory(directory: string): string[] {
  try {
    return readdirSync(directory).toSorted();
  } catch {
    return [];
  }
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
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
