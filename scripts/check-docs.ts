#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const canonicalGuideNames = [
  "getting-started",
  "configuration",
  "linking",
  "commands",
  "automation",
  "troubleshooting",
] as const;

const fixedActiveSurfaces = [
  "README.md",
  "docs/README.md",
  "docs/ja/README.md",
  "docs/contributing/documentation.md",
  "docs/contributing/writing.md",
  "editors/vscode/README.md",
] as const;

type MarkdownLink = {
  target: string;
};

export function checkDocumentation(root: string): string[] {
  const errors: string[] = [];
  checkGuideSet(root, "docs/user", errors);
  checkGuideSet(root, "docs/ja/user", errors);
  checkNavigation(root, errors);
  checkJapaneseAnnotations(root, errors);
  checkRelativeLinks(root, errors);
  return errors;
}

function checkGuideSet(root: string, directory: string, errors: string[]): void {
  const expected = new Set(canonicalGuideNames.map((name) => `${name}.md`));
  const actual = new Set(markdownFiles(join(root, directory)));

  for (const fileName of expected) {
    if (!actual.has(fileName)) {
      errors.push(`${directory} is missing canonical guide: ${fileName}`);
    }
  }
  for (const fileName of actual) {
    if (!expected.has(fileName)) {
      errors.push(`${directory} contains unexpected guide: ${fileName}`);
    }
  }
}

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [];
  }
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".md"))
    .toSorted();
}

function checkNavigation(root: string, errors: string[]): void {
  checkEntryPoint(root, "README.md", ["docs/README.md", "docs/ja/README.md"], errors);
  checkEntryPoint(
    root,
    "docs/README.md",
    [...canonicalGuideNames.map((name) => `docs/user/${name}.md`), "docs/contributing/writing.md"],
    errors,
  );
  checkEntryPoint(
    root,
    "docs/ja/README.md",
    canonicalGuideNames.map((name) => `docs/ja/user/${name}.md`),
    errors,
  );
}

function checkEntryPoint(
  root: string,
  entryPoint: string,
  requiredTargets: string[],
  errors: string[],
): void {
  const filePath = join(root, entryPoint);
  if (!existsSync(filePath)) {
    errors.push(`Missing documentation entry point: ${entryPoint}`);
    return;
  }
  const linkedPaths = new Set(
    extractMarkdownLinks(readFileSync(filePath, "utf8"))
      .map(({ target }) => resolveLinkPath(root, entryPoint, target))
      .filter((target): target is string => target !== null),
  );
  for (const requiredTarget of requiredTargets) {
    if (!linkedPaths.has(requiredTarget)) {
      errors.push(`${entryPoint} does not link to ${requiredTarget}`);
    }
  }
}

function checkJapaneseAnnotations(root: string, errors: string[]): void {
  for (const name of canonicalGuideNames) {
    const relativePath = `docs/ja/user/${name}.md`;
    const filePath = join(root, relativePath);
    if (existsSync(filePath) && containsActiveCodeAnnotation(readFileSync(filePath, "utf8"))) {
      errors.push(`${relativePath} must not contain @code annotations`);
    }
  }
}

function containsActiveCodeAnnotation(content: string): boolean {
  let fence: "`" | "~" | null = null;
  for (const line of content.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]?.[0];
      if (fence === null && (marker === "`" || marker === "~")) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
      continue;
    }
    if (fence === null && /<!--\s*@code\b/.test(line)) {
      return true;
    }
  }
  return false;
}

function checkRelativeLinks(root: string, errors: string[]): void {
  for (const sourcePath of activeSurfaces(root)) {
    const content = readFileSync(join(root, sourcePath), "utf8");
    for (const { target } of extractMarkdownLinks(content)) {
      checkRelativeLink(root, sourcePath, target, errors);
    }
  }
}

function activeSurfaces(root: string): string[] {
  const paths = fixedActiveSurfaces.filter((path) => existsSync(join(root, path)));
  const directoryFiles = ["docs/user", "docs/ja/user", "docs/integrations"].flatMap((directory) =>
    markdownFiles(join(root, directory)).map((fileName) => `${directory}/${fileName}`),
  );
  return [...paths, ...directoryFiles];
}

function extractMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  let fence: "`" | "~" | null = null;
  for (const line of content.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]?.[0];
      if (fence === null && (marker === "`" || marker === "~")) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    links.push(...extractMarkdownLinksFromLine(line));
  }
  return links;
}

function extractMarkdownLinksFromLine(line: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (let index = 0; index < line.length; ) {
    const inlineCodeEnd = findInlineCodeEnd(line, index);
    if (inlineCodeEnd !== null) {
      index = inlineCodeEnd;
      continue;
    }

    const character = line[index];
    let openingBracket: number | null = null;
    if (character === "[") {
      openingBracket = index;
    } else if (character === "!" && line[index + 1] === "[") {
      openingBracket = index + 1;
    }
    if (openingBracket !== null) {
      const link = parseMarkdownLink(line, openingBracket);
      if (link !== null) {
        links.push({ target: link.target });
        index = link.end;
        continue;
      }
    }
    index += 1;
  }
  return links;
}

function findInlineCodeEnd(line: string, start: number): number | null {
  if (line[start] !== "`") {
    return null;
  }

  const delimiterLength = countBackticks(line, start);
  for (let index = start + delimiterLength; index < line.length; ) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    const closingLength = countBackticks(line, index);
    if (closingLength === delimiterLength) {
      return index + closingLength;
    }
    index += closingLength;
  }
  return null;
}

function countBackticks(line: string, start: number): number {
  let count = 0;
  while (line[start + count] === "`") {
    count += 1;
  }
  return count;
}

type ParsedMarkdownLink = MarkdownLink & {
  end: number;
};

function parseMarkdownLink(line: string, openingBracket: number): ParsedMarkdownLink | null {
  let bracketDepth = 0;
  let closingBracket = -1;
  for (let index = openingBracket; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        closingBracket = index;
        break;
      }
    }
  }
  if (closingBracket < 0 || line[closingBracket + 1] !== "(") {
    return null;
  }

  const closingParenthesis = line.indexOf(")", closingBracket + 2);
  if (closingParenthesis < 0) {
    return null;
  }
  const destination = line.slice(closingBracket + 2, closingParenthesis);
  const match = /^(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?$/.exec(destination);
  const rawTarget = match?.[1];
  if (rawTarget === undefined) {
    return null;
  }
  return {
    target: rawTarget.replace(/^<|>$/g, ""),
    end: closingParenthesis + 1,
  };
}

function checkRelativeLink(
  root: string,
  sourcePath: string,
  target: string,
  errors: string[],
): void {
  if (isExternalTarget(target)) {
    return;
  }
  const [rawPath = "", rawFragment] = target.split("#", 2);
  const decodedPath = decodeURIComponent(rawPath.split("?", 1)[0] ?? "");
  const targetPath = decodedPath === "" ? sourcePath : normalizePath(root, sourcePath, decodedPath);
  const absoluteTarget = join(root, targetPath);
  if (!existsSync(absoluteTarget)) {
    errors.push(`${sourcePath} links to missing file: ${targetPath}`);
    return;
  }
  if (rawFragment === undefined || rawFragment === "" || statSync(absoluteTarget).isDirectory()) {
    return;
  }
  const fragment = decodeURIComponent(rawFragment);
  const anchors = githubHeadingAnchors(readFileSync(absoluteTarget, "utf8"));
  if (!anchors.has(fragment)) {
    errors.push(`${sourcePath} links to missing heading: ${targetPath}#${fragment}`);
  }
}

function isExternalTarget(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(target);
}

function resolveLinkPath(root: string, sourcePath: string, target: string): string | null {
  if (isExternalTarget(target)) {
    return null;
  }
  const rawPath = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (rawPath === "") {
    return sourcePath;
  }
  return normalizePath(root, sourcePath, decodeURIComponent(rawPath));
}

function normalizePath(root: string, sourcePath: string, targetPath: string): string {
  return relative(root, resolve(root, dirname(sourcePath), targetPath))
    .split(sep)
    .join("/");
}

function githubHeadingAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fence: "`" | "~" | null = null;
  for (const line of content.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]?.[0];
      if (fence === null && (marker === "`" || marker === "~")) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) {
      continue;
    }
    const base = githubSlug(heading);
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

function githubSlug(heading: string): string {
  return heading
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

if (import.meta.main) {
  const errors = checkDocumentation(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }
  console.log("Documentation structure is valid.");
}
