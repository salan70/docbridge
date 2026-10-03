#!/usr/bin/env bun

import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const codexTree = ".agents/skills";
const claudeTree = ".claude/skills";

/** The distributable skill, which the Codex tree links instead of copying. */
const templateSkill = { path: `${codexTree}/docbridge`, target: "templates/skills/docbridge" };

/** The shared agent guidance, and the Claude Code file that must import it. */
const sharedGuidance = "AGENTS.md";
const claudeGuidance = "CLAUDE.md";
const sharedImport = `@${sharedGuidance}`;

/**
 * A shared block this long is also reported when it is merged into a longer
 * Claude paragraph; a shorter one only when a Claude block equals it, so a
 * short phrase inside unrelated prose does not count as a copy.
 */
const minimumEmbeddedBlockLength = 60;

/** The Agent Skills rules for a skill's discovery metadata. */
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumSkillNameLength = 64;
const maximumSkillDescriptionLength = 1024;

/** Configurations whose exclusion list must never skip a skill tree. */
const exclusionConfigs = [
  { path: ".oxfmtrc.json", format: "json", key: "ignorePatterns" },
  { path: ".oxlintrc.json", format: "json", key: "ignorePatterns" },
  { path: ".rumdl.toml", format: "toml", key: "exclude" },
] as const;

/**
 * Check the AI asset layout: every skill lives once under the Codex tree with
 * valid discovery metadata, the Claude tree holds only symlinks that resolve to
 * the same skill, and `CLAUDE.md` imports the shared `AGENTS.md` body instead
 * of copying it.
 */
export function checkAiAssets(root: string): string[] {
  const errors: string[] = [];
  checkTemplateSkill(root, errors);
  checkLinkedSkills(root, errors);
  checkSkillMetadata(root, errors);
  checkExclusions(root, errors);
  checkAgentGuidance(root, errors);
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

/**
 * Check the frontmatter that agents read to discover each skill, following the
 * Agent Skills specification. A skill whose directory does not resolve is
 * already reported by the layout checks.
 */
function checkSkillMetadata(root: string, errors: string[]): void {
  for (const name of skillNames(root, codexTree)) {
    if (resolvePath(root, `${codexTree}/${name}`) === undefined) {
      continue;
    }
    const path = `${codexTree}/${name}/SKILL.md`;
    const content = readTextFile(join(root, path));
    if (content === undefined) {
      errors.push(`${path} is missing.`);
      continue;
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
    if (frontmatter === undefined) {
      errors.push(`${path} must begin with YAML frontmatter between \`---\` lines.`);
      continue;
    }
    const metadata = parseYamlMapping(frontmatter);
    if (metadata === undefined) {
      errors.push(`${path} frontmatter must be a YAML mapping.`);
      continue;
    }
    const repeatedKey = firstRepeatedTopLevelKey(frontmatter);
    if (repeatedKey !== undefined) {
      errors.push(`${path} frontmatter repeats the key ${JSON.stringify(repeatedKey)}.`);
      continue;
    }
    const skillName = metadata["name"];
    if (
      typeof skillName !== "string" ||
      skillName.length > maximumSkillNameLength ||
      !skillNamePattern.test(skillName)
    ) {
      errors.push(
        `${path} name must be 1-${maximumSkillNameLength} lowercase letters, digits, and single hyphens.`,
      );
    } else if (skillName !== name) {
      errors.push(
        `${path} name ${JSON.stringify(skillName)} must match its directory ${JSON.stringify(name)}.`,
      );
    }
    const description = metadata["description"];
    if (
      typeof description !== "string" ||
      description.trim() === "" ||
      [...description].length > maximumSkillDescriptionLength
    ) {
      errors.push(
        `${path} description must be a non-empty string of at most ${maximumSkillDescriptionLength} characters.`,
      );
    }
  }
}

/**
 * Bun's YAML parser keeps the last value of a repeated key, so a duplicate
 * that YAML forbids would pass silently. Compare the top-level keys instead.
 */
function firstRepeatedTopLevelKey(frontmatter: string): string | undefined {
  const seen = new Set<string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const key = /^(?:"([^"]*)"|'([^']*)'|([^\s#'"][^:]*?))\s*:(?:\s|$)/.exec(line);
    if (key === null) {
      continue;
    }
    const name = key[1] ?? key[2] ?? key[3] ?? "";
    if (seen.has(name)) {
      return name;
    }
    seen.add(name);
  }
  return undefined;
}

function parseYamlMapping(source: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = Bun.YAML.parse(source);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
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

function checkAgentGuidance(root: string, errors: string[]): void {
  const shared = readTextFile(join(root, sharedGuidance));
  const claude = readTextFile(join(root, claudeGuidance));
  if (shared === undefined) {
    errors.push(`${sharedGuidance} is missing.`);
  }
  if (claude === undefined) {
    errors.push(`${claudeGuidance} is missing.`);
  }
  if (shared === undefined || claude === undefined) {
    return;
  }

  const claudeBlocks = proseBlocks(claude);
  if (!outsideCodeFences(claude).some((line) => line.trim() === sharedImport)) {
    errors.push(
      `${claudeGuidance} must import the shared guidance with a standalone \`${sharedImport}\` line.`,
    );
  }
  const claudeBlockSet = new Set(claudeBlocks);
  const claudeText = claudeBlocks.join("\n");
  for (const block of proseBlocks(shared)) {
    const embedded = block.length >= minimumEmbeddedBlockLength && claudeText.includes(block);
    if (claudeBlockSet.has(block) || embedded) {
      errors.push(
        `${claudeGuidance} repeats shared guidance from ${sharedGuidance}: ${JSON.stringify(block)}`,
      );
    }
  }
}

/**
 * Split Markdown into whitespace-normalized paragraphs and list items outside
 * code fences, so a rule copied under another heading or rewrapped still
 * compares equal.
 */
function proseBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      blocks.push(current.join(" ").replace(/\s+/g, " ").trim());
      current = [];
    }
  };
  for (const line of outsideCodeFences(markdown)) {
    const listItem = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (line.trim() === "" || /^\s*#/.test(line)) {
      flush();
    } else if (listItem !== null) {
      flush();
      current.push(listItem[1] ?? "");
    } else {
      current.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/**
 * Blank out fenced code. A fence closes only with the same character repeated
 * at least as many times as it opened, as CommonMark specifies.
 */
function outsideCodeFences(markdown: string): string[] {
  const lines: string[] = [];
  let openFence: string | undefined;
  for (const line of markdown.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (openFence === undefined) {
      if (fence !== null) {
        openFence = fence[1];
      }
      lines.push(openFence === undefined ? line : "");
      continue;
    }
    const marker = fence?.[1];
    if (
      marker !== undefined &&
      marker[0] === openFence[0] &&
      marker.length >= openFence.length &&
      (fence?.[2] ?? "").trim() === ""
    ) {
      openFence = undefined;
    }
    lines.push("");
  }
  return lines;
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
  console.log("Claude and Codex AI assets and agent guidance are in sync.");
}
