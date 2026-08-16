import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectFiles, matchGlob, readManagedFile, validateGlobPattern } from "./glob";

test.each(["src/**/*.ts", "src/*.ts", "docs/specs/**/*.md", "**/*.ts", "a/b/c.ts"])(
  "validateGlobPattern accepts %s",
  (pattern) => {
    expect(validateGlobPattern(pattern)).toEqual({ ok: true });
  },
);

test.each([
  ["src/[a]/*.ts", "character class"],
  ["**.ts", "double-star not a full segment"],
  ["a/**b/c", "double-star mixed with a segment"],
  ["src/{a,b}/*.ts", "brace expansion"],
  ["src/file?.ts", "question mark"],
  ["", "empty pattern"],
])("validateGlobPattern rejects %s (%s)", (pattern) => {
  const result = validateGlobPattern(pattern);
  expect(result.ok).toBe(false);
});

test("matchGlob with * does not cross path segments", () => {
  expect(matchGlob("src/*.ts", "src/a.ts")).toBe(true);
  expect(matchGlob("src/*.ts", "src/nested/a.ts")).toBe(false);
});

test("matchGlob with ** crosses path segments", () => {
  expect(matchGlob("src/**/*.ts", "src/a.ts")).toBe(true);
  expect(matchGlob("src/**/*.ts", "src/nested/a.ts")).toBe(true);
  expect(matchGlob("src/**/*.ts", "src/nested/deep/a.ts")).toBe(true);
  expect(matchGlob("src/**/*.ts", "other/a.ts")).toBe(false);
});

test("matchGlob matches .ts, .md and textually matches .d.ts", () => {
  expect(matchGlob("src/**/*.ts", "src/a.ts")).toBe(true);
  expect(matchGlob("src/**/*.ts", "src/a.d.ts")).toBe(true);
  expect(matchGlob("docs/**/*.md", "docs/a.md")).toBe(true);
  expect(matchGlob("docs/**/*.md", "docs/a.ts")).toBe(false);
});

test("matchGlob is case-sensitive", () => {
  expect(matchGlob("src/*.ts", "SRC/a.ts")).toBe(false);
});

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "docbridge-glob-"));
}

test("collectFiles returns sorted matching paths and excludes .d.ts for code patterns", () => {
  const root = makeTmp();
  try {
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    writeFileSync(join(root, "src", "b.ts"), "");
    writeFileSync(join(root, "src", "a.ts"), "");
    writeFileSync(join(root, "src", "types.d.ts"), "");
    writeFileSync(join(root, "src", "nested", "c.ts"), "");

    expect(collectFiles(root, ["src/**/*.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/nested/c.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles keeps .md files (no .d.ts exclusion applies)", () => {
  const root = makeTmp();
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "a.md"), "");
    expect(collectFiles(root, ["docs/**/*.md"])).toEqual(["docs/a.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles ignores node_modules, .git, and dot-prefixed segments", () => {
  const root = makeTmp();
  try {
    mkdirSync(join(root, "src", "node_modules"), { recursive: true });
    mkdirSync(join(root, "src", ".git"), { recursive: true });
    mkdirSync(join(root, "src", ".hidden"), { recursive: true });
    writeFileSync(join(root, "src", "node_modules", "x.ts"), "");
    writeFileSync(join(root, "src", ".git", "y.ts"), "");
    writeFileSync(join(root, "src", ".hidden", "z.ts"), "");
    writeFileSync(join(root, "src", ".dotfile.ts"), "");
    writeFileSync(join(root, "src", "keep.ts"), "");

    expect(collectFiles(root, ["src/**/*.ts"])).toEqual(["src/keep.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles ignores symlink files and symlink directories", () => {
  const root = makeTmp();
  try {
    mkdirSync(join(root, "src", "real"), { recursive: true });
    writeFileSync(join(root, "src", "real", "a.ts"), "");
    writeFileSync(join(root, "src", "target.ts"), "");
    symlinkSync(join(root, "src", "target.ts"), join(root, "src", "link.ts"));
    symlinkSync(join(root, "src", "real"), join(root, "src", "linkdir"));

    expect(collectFiles(root, ["src/**/*.ts"])).toEqual(["src/real/a.ts", "src/target.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles on the real repo root finds known source files", () => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const files = collectFiles(repoRoot, ["src/**/*.ts"]);
  expect(files).toContain("src/core/links.ts");
  expect(files).toContain("src/core/config.ts");
  expect(files).toContain("src/core/glob.ts");
});

test("readManagedFile returns content for readable files", () => {
  const root = makeTmp();
  try {
    writeFileSync(join(root, "a.ts"), "hello");
    expect(readManagedFile(root, "a.ts")).toEqual({ ok: true, content: "hello" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readManagedFile returns file_read_error for unreadable files", () => {
  const root = makeTmp();
  try {
    const result = readManagedFile(root, "missing.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe("file_read_error");
      expect(result.diagnostic.severity).toBe("error");
      expect(result.diagnostic.target).toBe("missing.ts");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
