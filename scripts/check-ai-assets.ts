#!/usr/bin/env bun

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const codexTree = ".agents/skills";
const claudeTree = ".claude/skills";

/** The distributable skill, which the Codex tree links instead of copying. */
const templateSkill = { path: `${codexTree}/docbridge`, target: "templates/skills/docbridge" };

/**
 * Check the AI asset layout: every skill lives once under the Codex tree, and
 * the Claude tree holds only symlinks that resolve to the same skill.
 */
export function checkAiAssets(root: string): string[] {
  const errors: string[] = [];
  checkTemplateSkill(root, errors);
  checkLinkedSkills(root, errors);
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
    const codexPath = `${codexTree}/${name}`;
    if (codexPath !== templateSkill.path && isSymbolicLink(join(root, codexPath))) {
      errors.push(`${codexPath} must be a directory, not a symlink.`);
      continue;
    }
    const claudePath = `${claudeTree}/${name}`;
    const resolved = resolvePath(root, claudePath);
    if (
      !isSymbolicLink(join(root, claudePath)) ||
      resolved === undefined ||
      resolved !== resolvePath(root, codexPath)
    ) {
      errors.push(`${claudePath} must be a symlink that resolves to ${codexPath}.`);
    }
  }
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
  console.log("Claude and Codex skill trees are in sync.");
}
