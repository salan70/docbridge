/**
 * Filesystem operations and drift detection for the distributable skill trees.
 *
 * `init` and `upgrade` both install exactly one managed directory per agent
 * destination and both refuse to touch a symlink, so the guard lives here once
 * rather than in each command. Comparison against the packaged template is what
 * lets `upgrade` distinguish an untouched copy from a locally edited one.
 */

import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Every action a planned managed-asset operation can carry. */
export type FileOpAction =
  | "create"
  | "skip"
  | "overwrite"
  | "would-create"
  | "would-overwrite"
  | "remove"
  | "would-remove";

export type PlannedFileOp = {
  action: FileOpAction;
  path: string;
  content?: string;
  reason?: string;
};

export type SkillTreeComparison = {
  /** Files present in both trees whose bytes differ. */
  modified: string[];
  /** Template files absent from the installed copy. */
  missing: string[];
  /** Installed files with no template counterpart. */
  extra: string[];
};

/**
 * What sits at a managed destination, from the perspective of the operations
 * `init` and `upgrade` are allowed to perform.
 *
 * Only `absent` and `directory` are ever written to or removed. The remaining
 * kinds all mean "report it and leave it alone", each for a different reason a
 * user needs to see.
 */
export type ManagedPathKind =
  | "absent"
  | "directory"
  | "symlink"
  | "non-directory"
  | "symlinked-parent"
  | "blocked-parent";

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Classify a managed destination named relative to the project root.
 *
 * Every component below the project root is inspected, not just the final one.
 * A symlinked ancestor is the dangerous case: with `.claude/skills` linked to a
 * shared directory, `lstat` on `.claude/skills/docbridge-adopt` reports the
 * ordinary directory inside the link target, and a remove would delete a tree
 * outside the selected project root.
 *
 * @doc docs/specs/cli.md#managed-skill-assets
 */
export function classifyManagedPath(projectRoot: string, relativePath: string): ManagedPathKind {
  const segments = relativePath.split(/[/\\]/).filter((segment) => segment.length > 0);
  let current = projectRoot;

  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const isLast = index === segments.length - 1;

    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      // This component does not exist, so nothing below it can either. The
      // remaining ancestors are created by `mkdir -p` when the plan says create.
      return "absent";
    }

    if (stats.isSymbolicLink()) {
      return isLast ? "symlink" : "symlinked-parent";
    }
    if (!stats.isDirectory()) {
      return isLast ? "non-directory" : "blocked-parent";
    }
  }

  return segments.length === 0 ? "blocked-parent" : "directory";
}

/**
 * Explain, in one line, why a managed destination was left untouched.
 *
 * `init` and `upgrade` share the wording so the same situation reads the same
 * way whichever command reported it.
 */
export function unmanageablePathMessage(path: string, kind: ManagedPathKind): string {
  switch (kind) {
    case "symlink":
      return `Skill directory ${path} is a symlink and was left in place.`;
    case "symlinked-parent":
      return `Skill directory ${path} sits under a symlinked directory and was left in place, because writing through it would leave the project root.`;
    case "non-directory":
      return `${path} exists but is not a directory, so it was left in place.`;
    case "blocked-parent":
      return `Skill directory ${path} cannot be reached because a parent path component is not a directory, so it was left in place.`;
    default:
      return `Skill directory ${path} was left in place.`;
  }
}

/**
 * List every regular file under `directory`, as `/`-separated relative paths.
 * Symlinked entries are listed but never followed, so a link inside a skill
 * tree is reported as drift instead of being silently traversed.
 */
export function listSkillFiles(directory: string): string[] {
  const files: string[] = [];
  collectSkillFiles(directory, "", files);
  return files.toSorted();
}

/**
 * Compare an installed skill directory against its packaged template.
 *
 * @doc docs/specs/cli.md#managed-skill-assets
 */
export function compareSkillTree(installedDir: string, templateDir: string): SkillTreeComparison {
  const installedFiles = new Set(listSkillFiles(installedDir));
  const templateFiles = listSkillFiles(templateDir);
  const modified: string[] = [];
  const missing: string[] = [];

  for (const file of templateFiles) {
    if (!installedFiles.has(file)) {
      missing.push(file);
      continue;
    }
    installedFiles.delete(file);
    if (
      readFileOrUndefined(join(installedDir, file)) !== readFileOrUndefined(join(templateDir, file))
    ) {
      modified.push(file);
    }
  }

  return { modified, missing, extra: [...installedFiles].toSorted() };
}

/**
 * Apply one planned skill operation.
 *
 * The destination is re-classified immediately before it is touched, not only
 * while planning: a path that became a symlink, gained a symlinked ancestor, or
 * stopped being a directory in between must still be left alone. Only an
 * ordinary directory reached through ordinary directories is ever written to or
 * removed, so no operation can escape the selected project root.
 *
 * @doc docs/specs/cli.md#managed-skill-assets
 */
export function applySkillOperation(
  projectRoot: string,
  packageRoot: string,
  operation: PlannedFileOp,
): void {
  if (
    operation.action !== "create" &&
    operation.action !== "overwrite" &&
    operation.action !== "remove"
  ) {
    return;
  }

  const kind = classifyManagedPath(projectRoot, operation.path);
  const destinationDir = join(projectRoot, operation.path);

  if (operation.action === "remove") {
    if (kind === "directory") {
      rmSync(destinationDir, { recursive: true, force: true });
    }
    return;
  }

  if (kind !== "absent" && kind !== "directory") {
    return;
  }

  const skillName = operation.path.split(/[/\\]/).at(-1);
  if (skillName === undefined || skillName.length === 0) {
    return;
  }

  // Replace rather than merge: `upgrade --force` promises the packaged tree
  // exactly, so a file the template no longer ships must not survive.
  if (operation.action === "overwrite" && kind === "directory") {
    rmSync(destinationDir, { recursive: true, force: true });
  }

  mkdirSync(destinationDir, { recursive: true });
  cpSync(join(packageRoot, "templates", "skills", skillName), destinationDir, {
    recursive: true,
    force: true,
  });
}

function collectSkillFiles(root: string, prefix: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.toSorted((left, right) => (left.name < right.name ? -1 : 1))) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectSkillFiles(root, relativePath, files);
      continue;
    }
    files.push(relativePath);
  }
}

function readFileOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
