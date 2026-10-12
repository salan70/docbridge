import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CorpusEntry,
  corpusEntries,
  isCountedPath,
  parsePlanTables,
  sampleFiles,
} from "./corpus";

const PLAN_PATH = join(import.meta.dir, "../../docs/plans/single-binary-parser-gate-plan.md");
const CORPUS_PATH = join(import.meta.dir, "corpus.json");

const EXCLUDED_SEGMENTS = [
  "Pods",
  "Carthage",
  "vendor",
  "Vendor",
  "third_party",
  "ThirdParty",
  "node_modules",
  ".build",
  "build",
  "DerivedData",
  "generated",
  "Generated",
  "gen",
  ".dart_tool",
];

const DART_GENERATED_SUFFIXES = [
  ".g.dart",
  ".freezed.dart",
  ".gr.dart",
  ".mocks.dart",
  ".pb.dart",
  ".pbenum.dart",
  ".pbjson.dart",
  ".pbgrpc.dart",
  ".config.dart",
];

const planEntries = parsePlanTables(readFileSync(PLAN_PATH, "utf8"));

function sha256(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

test("a source file of the language is counted", () => {
  expect(isCountedPath("swift", "Sources/App/Main.swift")).toBe(true);
  expect(isCountedPath("dart", "lib/main.dart")).toBe(true);
});

test("a file of the other language or without the extension is not counted", () => {
  expect(isCountedPath("swift", "lib/main.dart")).toBe(false);
  expect(isCountedPath("dart", "Sources/App/Main.swift")).toBe(false);
  expect(isCountedPath("swift", "README.md")).toBe(false);
  expect(isCountedPath("swift", "Sources/Main.swiftx")).toBe(false);
});

test.each(EXCLUDED_SEGMENTS)("a path segment named %s is not counted", (segment) => {
  expect(isCountedPath("swift", `Sources/${segment}/Main.swift`)).toBe(false);
  expect(isCountedPath("dart", `lib/${segment}/main.dart`)).toBe(false);
});

test("an excluded name must be a whole path segment", () => {
  expect(isCountedPath("swift", "Sources/prebuild/Main.swift")).toBe(true);
  expect(isCountedPath("swift", "Sources/builder.swift")).toBe(true);
  expect(isCountedPath("swift", "src/vendored/Main.swift")).toBe(true);
  expect(isCountedPath("swift", "regen/Main.swift")).toBe(true);
});

test.each(DART_GENERATED_SUFFIXES)("a Dart file ending in %s is not counted", (suffix) => {
  expect(isCountedPath("dart", `lib/model${suffix}`)).toBe(false);
});

test("a Dart file name that only resembles a generated suffix is counted", () => {
  expect(isCountedPath("dart", "lib/pb.dart")).toBe(true);
  expect(isCountedPath("dart", "lib/config.dart")).toBe(true);
});

test("generated Dart suffixes do not apply to Swift files", () => {
  expect(isCountedPath("swift", "Sources/model.pb.swift")).toBe(true);
});

test("sampling keeps everything in path order when the count is within the limit", () => {
  expect(sampleFiles(["b.swift", "a.swift"], 2)).toEqual(["a.swift", "b.swift"]);
  expect(sampleFiles(["b.swift", "a.swift"], 5)).toEqual(["a.swift", "b.swift"]);
});

test("sampling keeps the files with the lowest SHA-256 of their path, in path order", () => {
  // Hash prefixes in ascending order: Tests/e.swift, Sources/c.swift,
  // Tests/d.swift, Sources/b.swift, Sources/a.swift.
  const paths = [
    "Sources/a.swift",
    "Sources/b.swift",
    "Sources/c.swift",
    "Tests/d.swift",
    "Tests/e.swift",
  ];
  expect(sampleFiles(paths, 2)).toEqual(["Sources/c.swift", "Tests/e.swift"]);
});

test("sampling does not depend on the input order", () => {
  const paths = [
    "Sources/a.swift",
    "Sources/b.swift",
    "Sources/c.swift",
    "Tests/d.swift",
    "Tests/e.swift",
  ];
  expect(sampleFiles(paths.toReversed(), 2)).toEqual(sampleFiles(paths, 2));
});

test("the kept files all hash below the dropped files", () => {
  const paths = Array.from({ length: 50 }, (_, index) => `Sources/File${index}.swift`);
  const kept = sampleFiles(paths, 10);
  expect(kept).toHaveLength(10);
  const maxKept = kept.map(sha256).toSorted().at(-1) ?? "";
  for (const path of paths.filter((candidate) => !kept.includes(candidate))) {
    expect(sha256(path) > maxKept).toBe(true);
  }
});

test("corpus.json matches the two tables of the plan", () => {
  expect(JSON.parse(readFileSync(CORPUS_PATH, "utf8"))).toEqual(planEntries);
});

test("the parsed plan tables have the stated number of repositories", () => {
  expect(planEntries.swift).toHaveLength(16);
  expect(planEntries.dart).toHaveLength(12);
});

function usedTotal(entries: readonly CorpusEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.used, 0);
}

test("the used totals match the plan", () => {
  expect(usedTotal(corpusEntries("swift"))).toBe(5246);
  expect(usedTotal(corpusEntries("dart"))).toBe(7361);
});

test("the development and holdout totals match the plan", () => {
  expect(usedTotal(corpusEntries("swift", "development"))).toBe(1766);
  expect(usedTotal(corpusEntries("swift", "holdout"))).toBe(3480);
  expect(usedTotal(corpusEntries("dart", "development"))).toBe(4056);
  expect(usedTotal(corpusEntries("dart", "holdout"))).toBe(3305);
});

test("no repository contributes more than 20% of the final holdout", () => {
  for (const language of ["swift", "dart"] as const) {
    const holdout = corpusEntries(language, "holdout");
    const total = holdout.reduce((sum, entry) => sum + entry.used, 0);
    for (const entry of holdout) {
      expect(entry.used * 5 <= total).toBe(true);
    }
  }
});

test("no repository contributes more than 20% of the corpus", () => {
  for (const language of ["swift", "dart"] as const) {
    const entries = corpusEntries(language);
    const total = entries.reduce((sum, entry) => sum + entry.used, 0);
    for (const entry of entries) {
      expect(entry.used * 5 <= total).toBe(true);
    }
  }
});

test("used never exceeds counted", () => {
  for (const language of ["swift", "dart"] as const) {
    for (const entry of corpusEntries(language)) {
      expect(entry.used <= entry.counted).toBe(true);
    }
  }
});

test("corpusEntries filters by set and keeps the table order", () => {
  expect(corpusEntries("swift", "development").map((entry) => entry.rank)).toEqual([
    4, 7, 8, 13, 19, 22,
  ]);
  expect(corpusEntries("dart", "development").map((entry) => entry.rank)).toEqual([
    1, 2, 6, 10, 31,
  ]);
});
